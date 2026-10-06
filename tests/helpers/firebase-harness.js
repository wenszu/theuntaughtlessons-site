// Test harness for assets/firebase.js.
//
// assets/firebase.js imports the Firebase SDK from https://www.gstatic.com/firebasejs/... and uses browser
// globals (window, localStorage, document, location, history). This helper rewrites those import
// specifiers to local stub modules (written to a scratch directory as .mjs), installs fakes for the
// browser globals, and imports the module. Every Firestore, Auth and Functions call is recorded in
// harness.log; a recording fake fetch stands in for the network the Supabase data layer uses.
//
// Nothing here talks to a real service. Firestore is a Map of document paths to plain objects.
//
// Usage:
//   const { createHarness } = require('./helpers/firebase-harness');
//   const harness = createHarness();                        // installs the globals once per process
//   const mod = await harness.loadFirebaseModule(sourceText, 'label');
//   harness.reset(); harness.signIn(); harness.seed('users/uid-1', {...});
//   await mod.saveUserProgress(...); harness.log; harness.fetchCalls; harness.events; harness.storage

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { setTimeout: realSleep } = require('timers/promises');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SUPABASE_DATA_SOURCE = path.join(REPO_ROOT, 'assets', 'supabase-data.js');

const FIXED_NOW = Date.parse('2026-10-06T10:00:00.000Z');

// Module copies go to the system temp directory (one folder per process, removed at exit).
let scratch = null;
function scratchDir() {
  if (!scratch) {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'utl-firebase-harness-'));
    process.on('exit', () => { try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (error) { /* best effort */ } });
  }
  return scratch;
}

// ---------------------------------------------------------------------------
// Stub SDK modules. They read the live harness through globalThis.__utlHarness so one copy on disk
// serves every module instance loaded in the process.

const STUBS = {
  'firebase-app.mjs': `
const h = () => globalThis.__utlHarness;
export function initializeApp(config) {
  h().record({ sdk: 'app', op: 'initializeApp', projectId: config && config.projectId });
  return { config };
}
`,
  'firebase-auth.mjs': `
const h = () => globalThis.__utlHarness;
export const browserLocalPersistence = 'local';
export function getAuth() { return h().auth; }
export function setPersistence() { return Promise.resolve(); }
export function connectAuthEmulator() {}
export function onAuthStateChanged(auth, callback) {
  Promise.resolve().then(() => callback(auth.currentUser || null));
  return () => {};
}
export class GoogleAuthProvider { setCustomParameters() {} }
export class OAuthProvider { constructor(id) { this.providerId = id; } setCustomParameters() {} }
export class FacebookAuthProvider { addScope() {} }
export function isSignInWithEmailLink() { return false; }
const stub = (name) => (...args) => {
  h().record({ sdk: 'auth', op: name });
  return Promise.resolve(null);
};
export const createUserWithEmailAndPassword = stub('createUserWithEmailAndPassword');
export const fetchSignInMethodsForEmail = stub('fetchSignInMethodsForEmail');
export const getRedirectResult = stub('getRedirectResult');
export const sendSignInLinkToEmail = stub('sendSignInLinkToEmail');
export const signInWithEmailAndPassword = stub('signInWithEmailAndPassword');
export const signInWithEmailLink = stub('signInWithEmailLink');
export const signInWithPopup = stub('signInWithPopup');
export const signInWithRedirect = stub('signInWithRedirect');
export const signOut = stub('signOut');
`,
  'firebase-firestore.mjs': `
const h = () => globalThis.__utlHarness;
const join = (parts) => parts.map(String).join('/');
export function getFirestore() { return { kind: 'db' }; }
export function connectFirestoreEmulator() {}
export function doc(parent, ...segments) {
  if (parent && parent.type === 'collection') return { type: 'doc', path: join([parent.path, segments[0] || h().newId()]) };
  return { type: 'doc', path: join(segments) };
}
export function collection(parent, ...segments) {
  if (parent && parent.type === 'doc') return { type: 'collection', path: join([parent.path, ...segments]) };
  return { type: 'collection', path: join(segments) };
}
export function query(ref, ...constraints) { return { type: 'query', path: ref.path, constraints }; }
export function where(field, op, value) { return { where: [field, op, value] }; }
export function orderBy(field, direction) { return { orderBy: [field, direction || 'asc'] }; }
export function limit(count) { return { limit: count }; }
export function serverTimestamp() { return { __serverTimestamp: true }; }
export class Timestamp {
  constructor(seconds, nanoseconds) { this.seconds = seconds; this.nanoseconds = nanoseconds || 0; }
  static fromMillis(millis) { return new Timestamp(Math.floor(millis / 1000), (millis % 1000) * 1e6); }
  static fromDate(date) { return Timestamp.fromMillis(date.getTime()); }
  static now() { return Timestamp.fromMillis(Date.now()); }
  toMillis() { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); }
  toDate() { return new Date(this.toMillis()); }
}
function snapshot(docPath) {
  const data = h().store.get(docPath);
  return {
    id: docPath.split('/').pop(),
    exists: () => data !== undefined,
    data: () => (data === undefined ? undefined : h().clone(data))
  };
}
export async function getDoc(ref) {
  h().record({ sdk: 'firestore', op: 'getDoc', path: ref.path });
  h().maybeFail('getDoc', ref.path);
  return snapshot(ref.path);
}
export async function getDocs(target) {
  const constraints = target.constraints || [];
  h().record({ sdk: 'firestore', op: 'getDocs', path: target.path, constraints: h().clone(constraints) });
  h().maybeFail('getDocs', target.path);
  let docs = h().collectionDocs(target.path).map((docPath) => snapshot(docPath));
  constraints.forEach((constraint) => {
    if (constraint && constraint.where && constraint.where[1] === '==') {
      const [field, , value] = constraint.where;
      docs = docs.filter((item) => (item.data() || {})[field] === value);
    }
  });
  return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) };
}
export async function setDoc(ref, data, options) {
  h().record({ sdk: 'firestore', op: 'setDoc', path: ref.path, data: h().clone(data), options: options ? h().clone(options) : null });
  h().maybeFail('setDoc', ref.path);
  h().apply(ref.path, data, Boolean(options && options.merge));
}
export async function updateDoc(ref, data) {
  h().record({ sdk: 'firestore', op: 'updateDoc', path: ref.path, data: h().clone(data) });
  h().maybeFail('updateDoc', ref.path);
  if (!h().store.has(ref.path)) throw Object.assign(new Error('No document to update'), { code: 'not-found' });
  h().apply(ref.path, data, true);
}
export async function deleteDoc(ref) {
  h().record({ sdk: 'firestore', op: 'deleteDoc', path: ref.path });
  h().maybeFail('deleteDoc', ref.path);
  h().store.delete(ref.path);
}
export async function runTransaction(db, fn) {
  h().record({ sdk: 'firestore', op: 'runTransaction' });
  h().maybeFail('runTransaction', '');
  const transaction = {
    async get(ref) {
      h().record({ sdk: 'firestore', op: 'transaction.get', path: ref.path });
      return snapshot(ref.path);
    },
    set(ref, data, options) {
      h().record({ sdk: 'firestore', op: 'transaction.set', path: ref.path, data: h().clone(data), options: options ? h().clone(options) : null });
      h().apply(ref.path, data, Boolean(options && options.merge));
      return transaction;
    },
    update(ref, data) {
      h().record({ sdk: 'firestore', op: 'transaction.update', path: ref.path, data: h().clone(data) });
      h().apply(ref.path, data, true);
      return transaction;
    }
  };
  return fn(transaction);
}
`,
  'firebase-functions.mjs': `
const h = () => globalThis.__utlHarness;
export function getFunctions() { return { kind: 'functions' }; }
export function connectFunctionsEmulator() {}
export function httpsCallable(functions, name) {
  return async (payload) => {
    h().record({ sdk: 'functions', op: 'callable', name });
    return { data: { ok: true } };
  };
}
`
};

const IMPORT_REWRITES = [
  [/"https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+\/firebase-app\.js"/g, '"./firebase-app.mjs"'],
  [/"https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+\/firebase-auth\.js"/g, '"./firebase-auth.mjs"'],
  [/"https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+\/firebase-firestore\.js"/g, '"./firebase-firestore.mjs"'],
  [/"https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+\/firebase-functions\.js"/g, '"./firebase-functions.mjs"'],
  // Node treats .js in this repo as CommonJS, so the data layer is copied next to the module as .mjs.
  [/import\("\.\/supabase-data\.js"\)/g, 'import("./supabase-data.mjs")']
];

// ---------------------------------------------------------------------------
// Minimal DOM: enough for the progress sync notice (style and aside elements appended to head/body,
// looked up again by id, with a button and a status span inside).

function fakeElement(tagName, document) {
  const element = {
    tagName,
    id: '',
    className: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    disabled: false,
    attributes: {},
    children: [],
    listeners: {},
    classList: {
      tokens: new Set(),
      add(token) { this.tokens.add(token); },
      remove(token) { this.tokens.delete(token); },
      contains(token) { return this.tokens.has(token); }
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] === undefined ? null : this.attributes[name]; },
    appendChild(child) {
      this.children.push(child);
      if (child.id) document.elementsById[child.id] = child;
      return child;
    },
    querySelector(selector) {
      // The notice has exactly one button and one span; both are created on demand.
      if (!this.queried) this.queried = {};
      if (!this.queried[selector]) this.queried[selector] = fakeElement(selector, document);
      return this.queried[selector];
    },
    addEventListener(name, handler) {
      (this.listeners[name] = this.listeners[name] || []).push(handler);
    }
  };
  return element;
}

function fakeDocument() {
  const document = {
    readyState: 'complete',
    elementsById: {},
    getElementById(id) { return this.elementsById[id] || null; },
    createElement(tagName) { return fakeElement(tagName, document); },
    addEventListener() {}
  };
  document.head = fakeElement('head', document);
  document.body = fakeElement('body', document);
  return document;
}

function fakeStorage() {
  const map = new Map();
  const storage = {
    getItem(key) { return map.has(String(key)) ? map.get(String(key)) : null; },
    setItem(key, value) { map.set(String(key), String(value)); },
    removeItem(key) { map.delete(String(key)); },
    clear() { map.clear(); },
    key(index) { return Array.from(map.keys())[index] || null; },
    get length() { return map.size; },
    snapshot() { return Object.fromEntries(map); }
  };
  return storage;
}

// ---------------------------------------------------------------------------

function deepMerge(target, source) {
  const result = Object.assign({}, target || {});
  Object.keys(source || {}).forEach((key) => {
    const value = source[key];
    const isObject = value && typeof value === 'object' && !Array.isArray(value) && !value.__serverTimestamp;
    const currentIsObject = result[key] && typeof result[key] === 'object' && !Array.isArray(result[key]);
    result[key] = isObject && currentIsObject ? deepMerge(result[key], value) : value;
  });
  return result;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value, (key, item) => (typeof item === 'function' ? '<fn>' : item)));
}

let harnessInstalled = false;
let moduleCounter = 0;

function createHarness() {
  if (globalThis.__utlHarness) return globalThis.__utlHarness;

  const harness = {
    now: FIXED_NOW,
    log: [],
    store: new Map(),
    auth: { currentUser: null },
    failures: [],
    fetchCalls: [],
    fetchHandlers: [],
    events: [],
    warnings: [],
    timers: [],
    timerCounter: 0,
    historyCalls: [],
    tokenRequests: [],
    sequence: [],
    idCounter: 0,
    storage: fakeStorage(),
    document: fakeDocument(),
    location: {},
    clone,

    record(entry) {
      this.log.push(entry);
      if (entry.sdk === 'firestore') this.sequence.push(`firestore:${entry.op}:${entry.path || ''}`);
    },
    newId() { this.idCounter += 1; return `generated-${this.idCounter}`; },

    // -- Firestore store ---------------------------------------------------
    seed(docPath, data) { this.store.set(docPath, clone(data)); },
    read(docPath) { return clone(this.store.get(docPath)); },
    collectionDocs(collectionPath) {
      const prefix = `${collectionPath}/`;
      return Array.from(this.store.keys()).filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'));
    },
    apply(docPath, data, merge) {
      const current = this.store.get(docPath);
      this.store.set(docPath, merge && current ? deepMerge(current, clone(data)) : clone(data));
    },
    // failWhen('setDoc', /completed_exercises/, error) makes the next matching call throw.
    failWhen(op, pattern, error) { this.failures.push({ op, pattern, error }); },
    maybeFail(op, docPath) {
      const index = this.failures.findIndex((item) => item.op === op && (!item.pattern || item.pattern.test(docPath)));
      if (index === -1) return;
      const [failure] = this.failures.splice(index, 1);
      throw failure.error || Object.assign(new Error(`Fake Firestore ${op} failed`), { code: 'unavailable' });
    },

    // -- Auth ----------------------------------------------------------------
    signIn(overrides = {}) {
      const self = this;
      this.auth.currentUser = Object.assign({
        uid: 'uid-1',
        email: 'member@example.test',
        displayName: 'Member One',
        photoURL: 'https://photos.example.test/member-one.jpg',
        providerData: [{ providerId: 'google.com' }],
        async getIdToken(forceRefresh) {
          self.tokenRequests.push(forceRefresh === true);
          return self.tokenFor(forceRefresh === true);
        }
      }, overrides);
      return this.auth.currentUser;
    },
    signOut() { this.auth.currentUser = null; },
    tokenFor(forceRefresh) { return forceRefresh ? 'fresh-firebase-token' : 'firebase-token'; },

    // -- Fake fetch ----------------------------------------------------------
    onFetch(method, match, respond) {
      this.fetchHandlers.push({
        method,
        match: typeof match === 'function' ? match : (requestPath) => requestPath.startsWith(match),
        respond: typeof respond === 'function' ? respond : () => respond
      });
      return this;
    },
    async fetch(url, init = {}) {
      const method = init.method || 'GET';
      const call = {
        method,
        url: String(url),
        path: String(url).replace(/^https?:\/\/[^/]+/, ''),
        headers: init.headers || {},
        body: init.body ? JSON.parse(init.body) : undefined
      };
      this.fetchCalls.push(call);
      this.sequence.push(`fetch:${method}:${call.path.split('?')[0]}`);
      const handler = this.fetchHandlers.find((item) => item.method === method && item.match(call.path));
      const answer = handler ? handler.respond(call) : (method === 'GET' ? [] : {});
      // { __hang: true } never answers; the request ends only when the caller's AbortController fires.
      if (answer && answer.__hang) {
        return new Promise((resolve, reject) => {
          if (init.signal) init.signal.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })));
        });
      }
      if (answer && answer.__throw) throw answer.__throw;
      if (answer && answer.__status) {
        return { ok: false, status: answer.__status, text: async () => JSON.stringify(answer.body || {}) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(answer) };
    },
    rpcCalls(name) { return this.fetchCalls.filter((call) => call.method === 'POST' && call.path === `/rest/v1/rpc/${name}`); },
    getCalls(table) { return this.fetchCalls.filter((call) => call.method === 'GET' && call.path.startsWith(`/rest/v1/${table}?`)); },

    // -- Browser -------------------------------------------------------------
    setLocation(href) {
      const url = new URL(href);
      this.location.href = url.href;
      this.location.origin = url.origin;
      this.location.search = url.search;
      this.location.pathname = url.pathname;
      this.location.hostname = url.hostname;
      this.location.protocol = url.protocol;
    },
    firestoreLog() { return this.log.filter((entry) => entry.sdk === 'firestore'); },
    firestoreWrites() { return this.firestoreLog().filter((entry) => /setDoc|updateDoc|deleteDoc|transaction\.set|transaction\.update/.test(entry.op)); },
    notice() { return this.document.getElementById('utlProgressSyncNotice'); },

    // -- Timers ----------------------------------------------------------------
    // Every setTimeout (global and window) lands here and fires only when a test says so, so a
    // 10 or 15 second production timeout costs nothing and nothing keeps the process alive.
    addTimer(handler, delay) {
      this.timerCounter += 1;
      this.timers.push({ id: this.timerCounter, handler, delay: Number(delay) || 0 });
      return this.timerCounter;
    },
    removeTimer(id) {
      const index = this.timers.findIndex((timer) => timer.id === id);
      if (index !== -1) this.timers.splice(index, 1);
    },
    pendingTimers() { return this.timers.map((timer) => timer.delay); },
    // Fires every pending timer in registration order (each at most once).
    fireTimers() {
      const due = this.timers.splice(0, this.timers.length);
      due.forEach((timer) => { if (typeof timer.handler === 'function') timer.handler(); });
      return due.length;
    },
    // Lets pending promise work settle without touching the fake timers.
    async flush(rounds = 5) {
      for (let index = 0; index < rounds; index += 1) await new Promise((resolve) => setImmediate(resolve));
      // Background work such as the first dynamic import of the data layer needs real file input and output, which a
      // few event loop turns do not always cover. A short real wait (the node timer, not the faked one) makes the
      // checks that look at background calls deterministic.
      await realSleep(15);
    },

    // Fresh state for a case. The stored data source and location are kept unless asked otherwise.
    reset(options = {}) {
      this.log.length = 0;
      this.store.clear();
      this.failures.length = 0;
      this.fetchCalls.length = 0;
      this.fetchHandlers.length = 0;
      this.events.length = 0;
      this.warnings.length = 0;
      this.timers.length = 0;
      this.historyCalls.length = 0;
      this.tokenRequests.length = 0;
      this.sequence.length = 0;
      this.idCounter = 0;
      this.auth.currentUser = null;
      if (options.keepStorage !== true) this.storage.clear();
      this.document = fakeDocument();
      globalThis.document = this.document;
      if (options.href) this.setLocation(options.href);
    },

    // -- Module loading --------------------------------------------------------
    // Writes the stubs and the data layer copy once, rewrites the import specifiers in sourceText and
    // imports it as a fresh module instance (a query string on the file URL defeats the module cache).
    async loadFirebaseModule(sourceText, label = 'firebase') {
      const dir = scratchDir();
      Object.entries(STUBS).forEach(([name, text]) => fs.writeFileSync(path.join(dir, name), text));
      fs.copyFileSync(SUPABASE_DATA_SOURCE, path.join(dir, 'supabase-data.mjs'));
      let text = sourceText;
      IMPORT_REWRITES.forEach(([pattern, replacement]) => { text = text.replace(pattern, replacement); });
      if (/https:\/\/www\.gstatic\.com/.test(text)) throw new Error('An SDK import was not rewritten.');
      const file = path.join(dir, `${label}.mjs`);
      fs.writeFileSync(file, text);
      moduleCounter += 1;
      return import(`${pathToFileURL(file).href}?instance=${moduleCounter}`);
    }
  };

  if (!harnessInstalled) {
    installGlobals(harness);
    harnessInstalled = true;
  }
  harness.setLocation('https://www.theuntaughtlessons.com/member-login/');
  globalThis.__utlHarness = harness;
  return harness;
}

function installGlobals(harness) {
  const RealDate = Date;
  // A fixed clock, so two module versions produce byte-identical logs.
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length) super(...args);
      else super(harness.now);
    }
    static now() { return harness.now; }
  }
  globalThis.Date = FixedDate;

  const window = {
    get localStorage() { return harness.storage; },
    get location() { return harness.location; },
    get document() { return harness.document; },
    history: {
      state: null,
      replaceState(state, title, url) {
        harness.historyCalls.push({ method: 'replaceState', url: String(url) });
        harness.setLocation(new URL(String(url), harness.location.href).href);
      }
    },
    listeners: {},
    addEventListener(name, handler) { (this.listeners[name] = this.listeners[name] || []).push(handler); },
    removeEventListener() {},
    dispatchEvent(event) {
      harness.events.push({ type: event.type, detail: clone(event.detail) });
      (this.listeners[event.type] || []).forEach((handler) => handler(event));
      return true;
    },
    setTimeout(handler, delay) { return harness.addTimer(handler, delay); },
    clearTimeout(id) { harness.removeTimer(id); }
  };
  globalThis.window = window;
  // The data layer uses the bare setTimeout for its request timeout; route it through the same registry.
  globalThis.setTimeout = (handler, delay) => harness.addTimer(handler, delay);
  globalThis.clearTimeout = (id) => harness.removeTimer(id);
  Object.defineProperty(globalThis, 'localStorage', { get: () => harness.storage, configurable: true });
  globalThis.document = harness.document;
  Object.defineProperty(globalThis, 'location', { get: () => harness.location, configurable: true });
  Object.defineProperty(globalThis, 'history', { get: () => window.history, configurable: true });
  try {
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'harness' }, configurable: true, writable: true });
  } catch (error) {
    // Node already defines navigator; firebase.js does not read it.
  }
  globalThis.fetch = (url, init) => harness.fetch(url, init);
  const realWarn = console.warn;
  console.warn = (...args) => { harness.warnings.push(args.map((item) => (item instanceof Error ? item.message : String(item)))); };
  harness.restoreConsole = () => { console.warn = realWarn; };
}

module.exports = { createHarness, FIXED_NOW, clone };
