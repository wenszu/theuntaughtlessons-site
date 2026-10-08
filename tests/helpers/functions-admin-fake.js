"use strict";

// Loads functions-admin/index.js with a fake firebase-admin so handlers can run with no emulator and no
// network. Firestore is a Map of document paths to plain objects. Sets NODE_ENV to "test" (the test hooks
// in index.js only exist then).
//
//   const { loadFunctionsAdmin } = require("./helpers/functions-admin-fake");
//   const env = loadFunctionsAdmin();           // env.db, env.exported, env.auth
//   env.db.seed("organizations/ali", {...});
//
// The fake Firestore refuses collectionGroup() the way live Firestore does when the collection group index is
// missing, so a regression to that query shows up as a thrown error.

const path = require("path");
const Module = require("module");

const FUNCTIONS_ADMIN_DIR = path.join(__dirname, "..", "..", "functions-admin");

function createFakeDb() {
  const store = new Map();
  const db = {
    store,
    failTransactions: false,
    transactionCount: 0,
    seed(docPath, data) { store.set(docPath, data); return db; },
    collection(name) { return collectionRef(name); },
    collectionGroup() {
      const error = new Error("9 FAILED_PRECONDITION: The query requires a COLLECTION_GROUP_ASC index for collection members and field uid.");
      error.code = 9;
      throw error;
    },
    async runTransaction(fn) {
      db.transactionCount += 1;
      if (db.failTransactions) throw new Error("limit store unavailable");
      const pending = [];
      const transaction = {
        get: async (ref) => docSnapshot(ref.path),
        set: (ref, data) => pending.push(["set", ref.path, data]),
        create: (ref, data) => pending.push(["set", ref.path, data]),
        update: (ref, data) => pending.push(["merge", ref.path, data]),
        delete: (ref) => pending.push(["delete", ref.path])
      };
      const result = await fn(transaction);
      pending.forEach(([op, docPath, data]) => {
        if (op === "set") store.set(docPath, data);
        else if (op === "merge") store.set(docPath, { ...(store.get(docPath) || {}), ...data });
        else store.delete(docPath);
      });
      return result;
    }
  };

  function docSnapshot(docPath) {
    const id = docPath.split("/").pop();
    const parts = docPath.split("/");
    return {
      id,
      exists: store.has(docPath),
      data: () => (store.has(docPath) ? { ...store.get(docPath) } : undefined),
      ref: docRef(docPath),
      parentPath: parts.slice(0, -1).join("/")
    };
  }

  let autoId = 0;
  function docRef(docPath) {
    const parts = docPath.split("/");
    return {
      path: docPath,
      id: parts[parts.length - 1],
      parent: { id: parts[parts.length - 2], parent: parts.length > 2 ? { id: parts[parts.length - 3] } : null },
      get: async () => docSnapshot(docPath),
      set: async (data, options) => {
        if (options && options.merge) store.set(docPath, deepMerge(store.get(docPath) || {}, data));
        else store.set(docPath, data);
      },
      collection: (name) => collectionRef(docPath + "/" + name)
    };
  }

  function collectionRef(collectionPath) {
    const get = async () => {
      const depth = collectionPath.split("/").length + 1;
      const docs = [...store.keys()]
        .filter((key) => key.startsWith(collectionPath + "/") && key.split("/").length === depth)
        .map(docSnapshot);
      return { docs, size: docs.length, empty: !docs.length, forEach: (callback) => docs.forEach(callback) };
    };
    return { path: collectionPath, doc: (id) => docRef(collectionPath + "/" + (id || "auto" + (autoId += 1))), get };
  }

  return db;
}

function deepMerge(base, patch) {
  const out = { ...base };
  Object.keys(patch).forEach((key) => {
    const value = patch[key];
    out[key] = value && typeof value === "object" && !Array.isArray(value) && typeof value.isEqual !== "function" && base[key] && typeof base[key] === "object"
      ? deepMerge(base[key], value)
      : value;
  });
  return out;
}

function createFakeAuth() {
  const users = new Map();
  let counter = 0;
  return {
    users,
    async getUserByEmail(email) {
      if (!users.has(email)) { const error = new Error("not found"); error.code = "auth/user-not-found"; throw error; }
      return users.get(email);
    },
    async createUser({ email, displayName }) {
      counter += 1;
      const record = { uid: "uid-" + counter, email, displayName };
      users.set(email, record);
      return record;
    }
  };
}

function loadFunctionsAdmin() {
  process.env.NODE_ENV = "test";
  const db = createFakeDb();
  const auth = createFakeAuth();
  const realFirestore = require(path.join(FUNCTIONS_ADMIN_DIR, "node_modules", "firebase-admin", "lib", "firestore"));
  const firestore = Object.assign(() => db, { FieldValue: realFirestore.FieldValue });
  const fakeAdmin = { initializeApp() {}, firestore, auth: () => auth };
  const adminPath = require.resolve("firebase-admin", { paths: [FUNCTIONS_ADMIN_DIR] });
  const indexPath = path.join(FUNCTIONS_ADMIN_DIR, "index.js");
  const previous = require.cache[adminPath];
  require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true, exports: fakeAdmin, children: [], paths: [] };
  delete require.cache[indexPath];
  let exported;
  try {
    exported = require(indexPath);
  } finally {
    if (previous) require.cache[adminPath] = previous; else delete require.cache[adminPath];
  }
  return { db, auth, exported };
}

module.exports = { loadFunctionsAdmin, createFakeDb };
