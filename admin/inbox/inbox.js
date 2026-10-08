// Admin Inbox: leads, feedback and data clean up. Owner only.
//
// Talks to the Supabase REST rpc functions from supabase/migrations/20261008002170_inbox_and_cleanup.sql:
//   POST {SUPABASE_URL}/rest/v1/rpc/<name>   apikey = publishable key, Authorization = Bearer <Firebase ID token>
// The server decides who may call them (only the platform owner). A refused call (HTTP 403 or SQLSTATE 42501)
// shows "You do not have access" and nothing else.
//
// Security rules for this file (it shows text typed by the public):
//   every value from the server is put on the page with textContent, never innerHTML;
//   no inline event handlers, no eval, nothing is built from data as markup or as a link;
//   the Firebase ID token is asked for on every request and never stored, shown or logged;
//   destructive actions need the typed word DELETE and, where the server has one, a dry run first;
//   no call sends more than 500 ids.
//
// The file runs in the browser as a classic script (window.UTLInbox) and in node (module.exports) so
// tests/admin-inbox.test.js can drive it with a fake document and a fake fetch.

(function (root) {
  "use strict";

  var SUPABASE_URL = "https://czljyikfavtjgqcibdda.supabase.co";
  // Public configuration, the same value as assets/firebase.js. Never put a secret or service role key here.
  var SUPABASE_PUBLISHABLE_KEY = "sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW";

  var PAGE_SIZE = 50;
  var MAX_IDS = 500;
  var MAX_DAYS = 36500;
  // The server refuses more than 100 people in one purge (admin_cleanup_preview reports max_per_purge).
  var MAX_PURGE_PEOPLE = 100;
  var MIN_ENGAGEMENT_DAYS = 30;
  var CONFIRM_WORD = "DELETE";
  var REQUEST_TIMEOUT_MS = 20000;
  var UNCERTAIN_TEXT = "The request did not finish. It may have completed. Run the dry run again to see what is left.";
  var NO_ACCESS_TEXT = "You do not have access";

  var FILTER_STATUSES = ["new", "reviewed", "contacted", "spam", "test", "archived"];
  var SET_STATUSES = ["reviewed", "contacted", "spam", "test", "archived", "new"];
  var JUNK_TYPES = {
    stability: ["javascript_error", "promise_rejection", "resource_error", "network_offline", "network_recovered", "video_stall", "video_error", "sync_error"],
    engagement: ["session", "activity"]
  };
  var PURGE_STATUSES = ["spam", "test", "archived"];

  var KINDS = {
    leads: {
      label: "Leads",
      columns: [
        { key: "created_at", label: "Received", date: true },
        { key: "kind", label: "Type" },
        { key: "name", label: "Name", max: 40 },
        { key: "email", label: "Email", max: 40 },
        { key: "role", label: "Role", max: 30 },
        { key: "score", label: "Score" },
        { key: "band", label: "Band", max: 24 },
        { key: "page", label: "Page", max: 30 },
        { key: "source", label: "Source", max: 24 },
        { key: "message", label: "Message", max: 80 },
        { key: "status", label: "Status" }
      ],
      fields: ["id", "kind", "name", "email", "role", "message", "score", "band", "variation_id", "assessment_type", "page", "source",
        "status", "is_test", "spam_reason", "note", "created_at", "handled_at"],
      longField: "message"
    },
    feedback: {
      label: "Feedback",
      columns: [
        { key: "created_at", label: "Received", date: true },
        { key: "name", label: "Name", max: 40 },
        { key: "email", label: "Email", max: 40 },
        { key: "feedback_type", label: "Type", max: 24 },
        { key: "page_url", label: "Page", max: 40 },
        { key: "description", label: "Description", max: 100 },
        { key: "status", label: "Status" }
      ],
      fields: ["id", "name", "email", "page_url", "feedback_type", "description", "activity_id", "status", "is_test",
        "spam_reason", "note", "created_at", "handled_at"],
      longField: "description"
    }
  };

  // ---------------------------------------------------------------------------
  // Pure helpers

  // One CSV cell. Every cell is quoted and inner quotes are doubled. A cell that a spreadsheet could read as
  // a formula (starts with = + - @, or a tab or carriage return, also after leading spaces) gets an apostrophe
  // in front so it stays plain text.
  function csvCell(value) {
    var s = value === null || value === undefined ? "" : String(value);
    if (/^(?:[\t\r]|\s*[=+\-@])/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function toCsv(rows, fields) {
    var lines = [fields.map(csvCell).join(",")];
    (rows || []).forEach(function (row) {
      lines.push(fields.map(function (f) { return csvCell(row ? row[f] : ""); }).join(","));
    });
    // A byte order mark lets Excel open UTF-8 names correctly.
    return "﻿" + lines.join("\r\n") + "\r\n";
  }

  function chunk(list, size) {
    var out = [];
    for (var i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }

  function shorten(value, max) {
    var s = value === null || value === undefined ? "" : String(value);
    if (max && s.length > max) return s.slice(0, max - 1) + "…";
    return s;
  }

  function formatDate(value) {
    if (!value) return "";
    var d = new Date(value);
    if (isNaN(d.getTime())) return shorten(value, 40);
    return d.toISOString().slice(0, 16).replace("T", " ");
  }

  function parseDays(raw, min) {
    var s = String(raw === null || raw === undefined ? "" : raw).trim();
    if (!/^\d+$/.test(s)) return null;
    var n = Number(s);
    return n >= (min || 0) && n <= MAX_DAYS ? n : null;
  }

  // Event types for one junk kind; null when a word is not one the server knows.
  function parseTypes(raw, kind) {
    var list = String(raw || "").split(",").map(function (t) { return t.trim(); }).filter(Boolean);
    var allowed = JUNK_TYPES[kind] || [];
    for (var i = 0; i < list.length; i++) {
      if (allowed.indexOf(list[i]) < 0) return null;
    }
    return list;
  }

  function isNoAccess(error) {
    if (!error) return false;
    return Number(error.status) === 403 || String(error.code || "") === "42501";
  }

  function describeError(error) {
    if (!error) return "Something went wrong.";
    if (error.name === "InboxApiError" && Number(error.status) === 401) {
      return "Your sign-in has expired. Reload this page, or sign in again from the admin console.";
    }
    if (Number(error.status) === 404 || String(error.code || "") === "PGRST202") {
      return "The Inbox functions are not available on the database yet.";
    }
    if (String(error.code || "") === "network/failed") return "Could not reach the data service. Check your connection and try again.";
    return shorten(error.message || "Something went wrong.", 300);
  }

  // ---------------------------------------------------------------------------
  // The data service

  function InboxApiError(message, details) {
    this.name = "InboxApiError";
    this.message = message;
    this.code = (details && details.code) || "";
    this.status = (details && details.status) || 0;
  }
  InboxApiError.prototype = Object.create(Error.prototype);
  InboxApiError.prototype.constructor = InboxApiError;

  // getToken(forceRefresh) returns the admin's current Firebase ID token. It is asked for on every request and
  // never kept. A 401 is retried once with a refreshed token.
  function createApi(options) {
    var fetchImpl = options.fetchImpl;
    var getToken = options.getToken;
    var baseUrl = String(options.supabaseUrl || SUPABASE_URL).replace(/\/+$/, "");
    var apiKey = options.publishableKey || SUPABASE_PUBLISHABLE_KEY;
    var timeoutMs = options.timeoutMs || REQUEST_TIMEOUT_MS;

    // Deletes and purges are never abandoned by a timer: the server may still be working on them.
    function isDestructive(name, a) {
      if (name === "admin_inbox_delete" || name === "admin_cleanup_purge_people") return true;
      return (name === "admin_inbox_purge" || name === "admin_cleanup_junk_events") && !(a && a.p_dry_run === true);
    }

    async function send(name, args, attempt) {
      var destructive = isDestructive(name, args);
      var token = "";
      try { token = await getToken(attempt > 0); } catch (e) { token = ""; }
      if (!token) throw new InboxApiError("Your sign-in session is not active.", { code: "auth/no-user", status: 401 });
      var controller = typeof AbortController === "function" ? new AbortController() : null;
      var timer = controller && !destructive ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;
      var response;
      try {
        response = await fetchImpl(baseUrl + "/rest/v1/rpc/" + name, {
          method: "POST",
          headers: {
            apikey: apiKey,
            Authorization: "Bearer " + token,
            Accept: "application/json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify(args || {}),
          signal: controller && !destructive ? controller.signal : undefined
        });
      } catch (e) {
        if (destructive) throw new InboxApiError(UNCERTAIN_TEXT, { code: "network/uncertain" });
        throw new InboxApiError("The connection to the data service failed.", { code: "network/failed" });
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
      var raw = "";
      try {
        raw = typeof response.text === "function" ? await response.text() : "";
      } catch (e) {
        if (destructive) throw new InboxApiError(UNCERTAIN_TEXT, { code: "network/uncertain" });
        throw new InboxApiError("The connection to the data service failed.", { code: "network/failed" });
      }
      var data = null;
      if (raw) { try { data = JSON.parse(raw); } catch (e) { data = null; } }
      if (!response.ok) {
        if (attempt === 0 && Number(response.status) === 401) return send(name, args, 1);
        var answer = data && typeof data === "object" && !Array.isArray(data) ? data : {};
        throw new InboxApiError(String(answer.message || "The data service answered " + response.status + "."), {
          code: answer.code || "http/" + response.status,
          status: Number(response.status)
        });
      }
      return data;
    }

    return {
      rpc: function (name, args) { return send(name, args, 0); }
    };
  }

  // ---------------------------------------------------------------------------
  // The page

  function createInbox(deps) {
    var doc = deps.document;
    var api = deps.api;
    var download = deps.download;
    var askConfirm = deps.confirm || function () { return false; };

    var state = { denied: false };
    var shell = {};

    // Builds an element. Text always goes in as textContent; attributes are constants set by this file.
    function h(tag, props) {
      var node = doc.createElement(tag);
      var p = props || {};
      if (p.className) node.className = p.className;
      if (p.text !== undefined && p.text !== null) node.textContent = String(p.text);
      if (p.id) node.setAttribute("id", p.id);
      if (p.type) node.setAttribute("type", p.type);
      if (p.href) node.setAttribute("href", p.href);
      if (p.placeholder) node.setAttribute("placeholder", p.placeholder);
      if (p.title) node.setAttribute("title", p.title);
      if (p.role) node.setAttribute("role", p.role);
      if (p.label) node.setAttribute("aria-label", p.label);
      if (p.min !== undefined) node.setAttribute("min", String(p.min));
      if (p.max !== undefined) node.setAttribute("max", String(p.max));
      if (p.value !== undefined) node.value = p.value;
      if (p.checked !== undefined) node.checked = Boolean(p.checked);
      if (p.disabled !== undefined) node.disabled = Boolean(p.disabled);
      if (p.hidden !== undefined) node.hidden = Boolean(p.hidden);
      if (p.on) Object.keys(p.on).forEach(function (name) { node.addEventListener(name, p.on[name]); });
      var kids = [];
      for (var i = 2; i < arguments.length; i++) kids = kids.concat(arguments[i]);
      kids.forEach(function (kid) {
        if (kid === null || kid === undefined || kid === false) return;
        node.appendChild(typeof kid === "string" ? doc.createTextNode(kid) : kid);
      });
      return node;
    }

    function clear(node) { node.textContent = ""; }

    function labeled(text, control, className) {
      return h("label", { className: "ib-field " + (className || "") }, h("span", { text: text }), control);
    }

    function setMessage(node, text, kind) {
      node.textContent = text || "";
      node.className = "ib-message" + (kind ? " ib-" + kind : "");
    }

    function showNoAccess() {
      state.denied = true;
      clear(shell.main);
      shell.main.appendChild(h("div", { className: "ib-denied", role: "alert" },
        h("h2", { text: NO_ACCESS_TEXT }),
        h("p", { text: "The Inbox is only for the site owner. If you should be able to use it, sign in with the owner account on the admin console and open this page again." }),
        h("p", {}, h("a", { href: "../", text: "Back to the admin console" }))));
    }

    function handleError(error, messageNode) {
      if (isNoAccess(error)) { showNoAccess(); return; }
      if (messageNode) setMessage(messageNode, describeError(error), "error");
    }

    // Runs one action: disables its button while it works and shows any error in the message line.
    async function guarded(button, messageNode, work, after) {
      if (button) button.disabled = true;
      try {
        await work();
      } catch (error) {
        handleError(error, messageNode);
      } finally {
        if (button) button.disabled = false;
        if (after) after();
      }
    }

    function idsOf(set) { return Array.from(set); }

    // -------------------------------------------------------------------------
    // Leads and Feedback

    function buildInbox(kind) {
      var cfg = KINDS[kind];
      var s = {
        status: "new", search: "", includeTest: false, offset: 0, total: 0, rows: [],
        selected: new Set(), detailId: null, loaded: false, ticket: 0, purgeKey: null, confirmCount: 0
      };
      var ids = function (name) { return kind + "-" + name; };

      var message = h("p", { id: ids("message"), className: "ib-message", role: "status" });
      var statusOptions = FILTER_STATUSES.map(function (v) { return h("option", { text: v, value: v }); });
      var statusSelect = h("select", { id: ids("status"), label: "Status" },
        statusOptions.concat([h("option", { text: "all but spam", value: "all" })]));
      statusSelect.value = "new";
      var searchInput = h("input", { id: ids("search"), type: "search", placeholder: "Search name, email or text", label: "Search" });
      var testBox = h("input", { id: ids("show-test"), type: "checkbox", checked: false });
      var searchBtn = h("button", { id: ids("search-btn"), type: "button", className: "ib-btn ib-primary", text: "Search" });
      var exportBtn = h("button", { id: ids("export"), type: "button", className: "ib-btn", text: "Export CSV" });
      var countLabel = h("span", { id: ids("count"), className: "ib-count" });
      var tableWrap = h("div", { id: ids("table"), className: "ib-table-wrap" });
      var prevBtn = h("button", { id: ids("prev"), type: "button", className: "ib-btn", text: "Previous" });
      var nextBtn = h("button", { id: ids("next"), type: "button", className: "ib-btn", text: "Next" });
      var detail = h("div", { id: ids("detail"), className: "ib-detail", hidden: true });

      // Bulk bar
      var bulkNote = h("input", { id: ids("bulk-note"), type: "text", placeholder: "Optional note", label: "Note for selected" });
      var selectedLabel = h("span", { id: ids("selected"), className: "ib-count", text: "0 selected" });
      var bulkStatusBtns = SET_STATUSES.map(function (st) {
        var b = h("button", { type: "button", className: "ib-btn", text: "Mark " + st, id: ids("bulk-" + st) });
        b.addEventListener("click", function () { applyStatus(idsOf(s.selected), st, bulkNote.value, b); });
        return b;
      });
      var deleteBtn = h("button", { id: ids("delete-selected"), type: "button", className: "ib-btn ib-danger", text: "Delete selected" });
      var deleteBox = h("div", { id: ids("delete-box"), className: "ib-confirm", hidden: true });
      var deleteInput = h("input", { id: ids("delete-input"), type: "text", placeholder: "Type " + CONFIRM_WORD, label: "Type " + CONFIRM_WORD + " to confirm" });
      var deleteConfirm = h("button", { id: ids("delete-confirm"), type: "button", className: "ib-btn ib-danger", text: "Delete permanently", disabled: true });
      var deleteCancel = h("button", { id: ids("delete-cancel"), type: "button", className: "ib-btn", text: "Cancel" });
      var deleteText = h("p", { id: ids("delete-text") });
      deleteBox.appendChild(deleteText);
      deleteBox.appendChild(h("div", { className: "ib-row" }, deleteInput, deleteConfirm, deleteCancel));

      // Purge box
      var purgeBoxes = {};
      var purgeBoxRow = h("div", { className: "ib-row" });
      PURGE_STATUSES.forEach(function (st) {
        purgeBoxes[st] = h("input", { id: ids("purge-" + st), type: "checkbox", checked: st === "spam" });
        purgeBoxRow.appendChild(h("label", { className: "ib-check" }, purgeBoxes[st], h("span", { text: st })));
      });
      var purgeDays = h("input", { id: ids("purge-days"), type: "number", min: 0, max: MAX_DAYS, value: "30", label: "Older than days" });
      var purgeDry = h("button", { id: ids("purge-dry"), type: "button", className: "ib-btn", text: "Dry run (count only)" });
      var purgeResult = h("p", { id: ids("purge-result"), className: "ib-message", role: "status" });
      var purgeInput = h("input", { id: ids("purge-input"), type: "text", placeholder: "Type " + CONFIRM_WORD, label: "Type " + CONFIRM_WORD + " to confirm the purge" });
      var purgeRun = h("button", { id: ids("purge-run"), type: "button", className: "ib-btn ib-danger", text: "Delete matching entries", disabled: true });
      var purgeConfirmRow = h("div", { className: "ib-row", hidden: true }, purgeInput, purgeRun);

      function selectedPurgeStatuses() { return PURGE_STATUSES.filter(function (st) { return purgeBoxes[st].checked; }); }
      function purgeParams() {
        var days = parseDays(purgeDays.value);
        var statuses = selectedPurgeStatuses();
        if (days === null || !statuses.length) return null;
        return { p_kind: kind, p_statuses: statuses, p_older_than_days: days };
      }
      function purgeSignature() {
        var p = purgeParams();
        return p ? p.p_statuses.join("+") + "|" + p.p_older_than_days : null;
      }
      function updatePurgeGate() {
        var ok = s.purgeKey !== null && s.purgeKey === purgeSignature() && purgeInput.value === CONFIRM_WORD;
        purgeRun.disabled = !ok;
      }
      // Forgets the dry run. Unless quiet, the dry run's count is also removed from the screen.
      function resetPurge(quiet) {
        if (quiet !== true && s.purgeKey !== null) setMessage(purgeResult, "", "");
        s.purgeKey = null;
        purgeConfirmRow.hidden = true;
        purgeInput.value = "";
        updatePurgeGate();
      }

      function updateDeleteGate() { deleteConfirm.disabled = deleteInput.value !== CONFIRM_WORD; }
      // closeDelete also forgets the count the confirm box showed, so a typed DELETE never applies to a different selection.
      function closeDelete() { deleteBox.hidden = true; deleteInput.value = ""; s.confirmCount = 0; updateDeleteGate(); }

      function updateSelectedLabel() {
        selectedLabel.textContent = s.selected.size + " selected";
        deleteBtn.disabled = s.selected.size === 0;
        bulkStatusBtns.forEach(function (b) { b.disabled = s.selected.size === 0; });
      }

      function renderCount() {
        var from = s.total === 0 ? 0 : s.offset + 1;
        var to = Math.min(s.offset + s.rows.length, s.total);
        countLabel.textContent = "Showing " + from + " to " + to + " of " + s.total;
        prevBtn.disabled = s.offset <= 0;
        nextBtn.disabled = s.offset + PAGE_SIZE >= s.total;
      }

      function renderTable() {
        clear(tableWrap);
        if (!s.rows.length) {
          tableWrap.appendChild(h("p", { className: "ib-empty", text: "Nothing here for this filter." }));
          return;
        }
        var allBox = h("input", {
          type: "checkbox", id: ids("select-all"), label: "Select all on this page",
          checked: s.rows.length > 0 && s.rows.every(function (r) { return s.selected.has(r.id); }),
          on: {
            change: function (e) {
              var on = Boolean(e.target.checked);
              s.rows.forEach(function (r) { if (on) s.selected.add(r.id); else s.selected.delete(r.id); });
              closeDelete();
              renderTable();
              updateSelectedLabel();
            }
          }
        });
        var headRow = h("tr", {}, h("th", {}, allBox));
        cfg.columns.forEach(function (c) { headRow.appendChild(h("th", { text: c.label })); });
        var tbody = h("tbody", {});
        s.rows.forEach(function (row, index) {
          var box = h("input", {
            type: "checkbox", id: ids("row-select-" + index), label: "Select this entry", checked: s.selected.has(row.id),
            on: {
              click: function (e) { if (e.stopPropagation) e.stopPropagation(); },
              change: function (e) {
                if (e.target.checked) s.selected.add(row.id); else s.selected.delete(row.id);
                closeDelete();
                updateSelectedLabel();
              }
            }
          });
          var tr = h("tr", {
            id: ids("row-" + index),
            className: "ib-row-item" + (row.id === s.detailId ? " is-open" : ""),
            on: { click: function () { openDetail(row); } }
          }, h("td", {}, box));
          cfg.columns.forEach(function (c) {
            var raw = row[c.key];
            var cell = h("td", { text: c.date ? formatDate(raw) : shorten(raw, c.max) });
            if (c.key === "status") {
              clear(cell);
              cell.appendChild(h("span", { className: "ib-badge ib-st-" + (FILTER_STATUSES.indexOf(row.status) >= 0 ? row.status : "other"), text: row.status }));
              if (row.is_test) cell.appendChild(h("span", { className: "ib-badge ib-st-test", text: "test" }));
              if (row.spam_reason) cell.appendChild(h("span", { className: "ib-badge ib-st-spam", title: shorten(row.spam_reason, 200), text: "flagged" }));
            }
            tr.appendChild(cell);
          });
          tbody.appendChild(tr);
        });
        tableWrap.appendChild(h("table", { className: "ib-table" }, h("thead", {}, headRow), tbody));
      }

      function openDetail(row) {
        s.detailId = row.id;
        detail.hidden = false;
        clear(detail);
        var noteInput = h("input", { id: ids("detail-note"), type: "text", placeholder: "Optional note", value: row.note || "", label: "Note" });
        var detailMessage = h("p", { id: ids("detail-message"), className: "ib-message", role: "status" });
        var dl = h("dl", { className: "ib-dl" });
        cfg.fields.forEach(function (f) {
          var v = row[f];
          var shown = v === null || v === undefined || v === "" ? "-" : (f === "created_at" || f === "handled_at") ? formatDate(v) + " (" + String(v) + ")" : String(v);
          dl.appendChild(h("dt", { text: f }));
          dl.appendChild(h("dd", { className: f === cfg.longField ? "ib-long" : "", text: shown }));
        });
        var buttons = h("div", { className: "ib-row" });
        SET_STATUSES.forEach(function (st) {
          var b = h("button", { type: "button", id: ids("detail-" + st), className: "ib-btn", text: "Mark " + st });
          b.addEventListener("click", function () { applyStatus([row.id], st, noteInput.value, b, detailMessage); });
          buttons.appendChild(b);
        });
        detail.appendChild(h("div", { className: "ib-row ib-between" },
          h("h3", { text: "Details" }),
          h("button", { type: "button", id: ids("detail-close"), className: "ib-btn", text: "Close", on: { click: closeDetail } })));
        detail.appendChild(dl);
        detail.appendChild(labeled("Note", noteInput));
        detail.appendChild(buttons);
        detail.appendChild(detailMessage);
        renderTable();
      }

      function closeDetail() {
        s.detailId = null;
        detail.hidden = true;
        clear(detail);
        renderTable();
      }

      async function load() {
        var ticket = ++s.ticket;
        setMessage(message, "Loading...", "");
        var data;
        try {
          data = await api.rpc("admin_inbox_list", {
            p_kind: kind,
            p_status: s.status === "all" ? null : s.status,
            p_search: s.search ? s.search : null,
            p_include_test: s.includeTest,
            p_limit: PAGE_SIZE,
            p_offset: s.offset
          });
        } catch (error) {
          if (ticket === s.ticket) handleError(error, message);
          return false;
        }
        if (ticket !== s.ticket) return false; // a newer request replaced this one
        var rows = [];
        var total = 0;
        if (Array.isArray(data)) { rows = data; total = data.length; }
        else if (data && typeof data === "object") {
          rows = Array.isArray(data.rows) ? data.rows : [];
          total = Number(data.total);
          if (!isFinite(total) || total < rows.length) total = rows.length;
        }
        s.rows = rows;
        s.total = total;
        s.loaded = true;
        // The server also returns how many entries each status holds; show them in the filter.
        if (data && data.counts && typeof data.counts === "object") {
          statusOptions.forEach(function (opt, i) {
            var n = data.counts[FILTER_STATUSES[i]];
            opt.textContent = FILTER_STATUSES[i] + (typeof n === "number" ? " (" + n + ")" : "");
          });
        }
        // Keep only selections that are still on this page.
        var present = new Set(rows.map(function (r) { return r.id; }));
        s.selected.forEach(function (id) { if (!present.has(id)) s.selected.delete(id); });
        setMessage(message, "", "");
        if (s.detailId !== null && !present.has(s.detailId)) { s.detailId = null; detail.hidden = true; clear(detail); }
        var open = rows.filter(function (r) { return r.id === s.detailId; })[0];
        if (open) openDetail(open);
        renderTable();
        renderCount();
        updateSelectedLabel();
        // The data changed under any dry run or open confirmation; neither may be reused.
        resetPurge();
        closeDelete();
        return true;
      }

      function reloadFrom(offset) {
        s.offset = Math.max(0, offset);
        return load();
      }

      function runSearch() {
        s.status = statusSelect.value;
        s.search = String(searchInput.value || "").trim().slice(0, 200);
        s.includeTest = Boolean(testBox.checked);
        s.selected.clear();
        closeDelete();
        return reloadFrom(0);
      }

      async function applyStatus(idList, status, note, button, messageNode) {
        var out = messageNode || message;
        if (!idList.length) { setMessage(out, "Select at least one entry first.", "error"); return; }
        if (idList.length > MAX_IDS) { setMessage(out, "Select at most " + MAX_IDS + " entries at a time.", "error"); return; }
        if (SET_STATUSES.indexOf(status) < 0) return;
        await guarded(button, out, async function () {
          await api.rpc("admin_inbox_set_status", {
            p_kind: kind,
            p_ids: idList,
            p_status: status,
            p_note: String(note || "").trim().slice(0, 2000)
          });
          resetPurge();
          if (await load()) setMessage(message, idList.length + " marked " + status + ".", "ok");
        });
      }

      async function deleteSelected() {
        // The typed word is checked again here, not only by the disabled button.
        if (deleteInput.value !== CONFIRM_WORD) { setMessage(message, "Type " + CONFIRM_WORD + " to delete.", "error"); return; }
        var idList = idsOf(s.selected);
        if (!idList.length) { setMessage(message, "Select at least one entry first.", "error"); return; }
        if (idList.length !== s.confirmCount) {
          closeDelete();
          setMessage(message, "The selection changed after the confirmation was shown. Press Delete selected again.", "error");
          return;
        }
        await guarded(deleteConfirm, message, async function () {
          var deleted = 0;
          var batches = chunk(idList, MAX_IDS);
          for (var i = 0; i < batches.length; i++) {
            var res = await api.rpc("admin_inbox_delete", { p_kind: kind, p_ids: batches[i] });
            deleted += Number(res && res.deleted) || 0;
          }
          s.selected.clear();
          closeDelete();
          resetPurge();
          var page = s.offset;
          if (page > 0 && idList.length >= s.rows.length) page = Math.max(0, page - PAGE_SIZE);
          if (await reloadFrom(page)) setMessage(message, deleted + " deleted.", "ok");
        }, function () { closeDelete(); resetPurge(true); });
      }

      async function purgeDryRun() {
        var params = purgeParams();
        if (!params) { setMessage(purgeResult, "Pick at least one status and a number of days from 0 to " + MAX_DAYS + ".", "error"); return; }
        await guarded(purgeDry, purgeResult, async function () {
          var res = await api.rpc("admin_inbox_purge", {
            p_kind: params.p_kind, p_statuses: params.p_statuses, p_older_than_days: params.p_older_than_days, p_dry_run: true
          });
          var matched = Number(res && res.matched) || 0;
          s.purgeKey = purgeSignature();
          purgeInput.value = "";
          purgeConfirmRow.hidden = matched === 0;
          setMessage(purgeResult, matched + " entries match (" + params.p_statuses.join(", ") + ", older than " + params.p_older_than_days +
            " days). Nothing was deleted." + (matched ? " To delete them, type " + CONFIRM_WORD + " and press the red button." : ""), "ok");
          updatePurgeGate();
        });
      }

      async function purgeConfirm() {
        var params = purgeParams();
        if (!params || s.purgeKey === null || s.purgeKey !== purgeSignature()) {
          resetPurge();
          setMessage(purgeResult, "Run the dry run again: the settings changed.", "error");
          return;
        }
        if (purgeInput.value !== CONFIRM_WORD) { setMessage(purgeResult, "Type " + CONFIRM_WORD + " to purge.", "error"); return; }
        await guarded(purgeRun, purgeResult, async function () {
          var res = await api.rpc("admin_inbox_purge", {
            p_kind: params.p_kind, p_statuses: params.p_statuses, p_older_than_days: params.p_older_than_days, p_dry_run: false
          });
          var deleted = Number(res && res.deleted) || 0;
          resetPurge();
          await reloadFrom(0);
          setMessage(purgeResult, deleted + " deleted.", "ok");
        }, function () { resetPurge(true); });
      }

      function exportCsv() {
        if (!s.rows.length) { setMessage(message, "There are no rows loaded to export.", "error"); return; }
        var stamp = new Date().toISOString().slice(0, 10);
        download(kind + "-" + stamp + ".csv", toCsv(s.rows, cfg.fields));
        setMessage(message, s.rows.length + " rows exported (the rows loaded on this page).", "ok");
      }

      searchBtn.addEventListener("click", runSearch);
      searchInput.addEventListener("keydown", function (e) { if (e.key === "Enter") runSearch(); });
      statusSelect.addEventListener("change", runSearch);
      testBox.addEventListener("change", runSearch);
      prevBtn.addEventListener("click", function () { s.selected.clear(); reloadFrom(s.offset - PAGE_SIZE); });
      nextBtn.addEventListener("click", function () { s.selected.clear(); reloadFrom(s.offset + PAGE_SIZE); });
      exportBtn.addEventListener("click", exportCsv);
      deleteBtn.addEventListener("click", function () {
        if (!s.selected.size) { setMessage(message, "Select at least one entry first.", "error"); return; }
        s.confirmCount = s.selected.size;
        deleteText.textContent = "This permanently deletes " + s.selected.size + " selected " + (s.selected.size === 1 ? "entry" : "entries") +
          " and cannot be undone. Type " + CONFIRM_WORD + " to confirm.";
        deleteBox.hidden = false;
        deleteInput.value = "";
        updateDeleteGate();
      });
      deleteInput.addEventListener("input", updateDeleteGate);
      deleteConfirm.addEventListener("click", deleteSelected);
      deleteCancel.addEventListener("click", closeDelete);
      purgeDry.addEventListener("click", purgeDryRun);
      purgeRun.addEventListener("click", purgeConfirm);
      purgeInput.addEventListener("input", updatePurgeGate);
      [purgeDays].concat(PURGE_STATUSES.map(function (st) { return purgeBoxes[st]; })).forEach(function (control) {
        control.addEventListener("input", resetPurge);
        control.addEventListener("change", resetPurge);
      });

      var panel = h("section", { id: ids("panel"), className: "ib-panel", role: "tabpanel", hidden: true },
        h("div", { className: "ib-row ib-filters" },
          labeled("Status", statusSelect),
          labeled("Search", searchInput, "ib-grow"),
          h("label", { className: "ib-check" }, testBox, h("span", { text: "Show test entries" })),
          searchBtn, exportBtn),
        message,
        h("div", { className: "ib-row ib-between" }, countLabel,
          h("div", { className: "ib-row" }, prevBtn, nextBtn)),
        tableWrap,
        h("div", { className: "ib-bulk" },
          h("div", { className: "ib-row" }, selectedLabel, bulkNote, bulkStatusBtns, deleteBtn),
          deleteBox),
        detail,
        h("details", { className: "ib-purge" },
          h("summary", { text: "Purge old entries" }),
          h("p", { className: "ib-hint", text: "Removes every entry with the chosen statuses that is older than the number of days. Run the dry run first; it only counts." }),
          purgeBoxRow,
          h("div", { className: "ib-row" }, labeled("Older than (days)", purgeDays), purgeDry),
          purgeResult, purgeConfirmRow));

      updateSelectedLabel();
      renderCount();
      return {
        panel: panel,
        ensureLoaded: function () { if (!s.loaded) return load(); return Promise.resolve(); },
        state: s
      };
    }

    // -------------------------------------------------------------------------
    // Data clean up

    // Tables whose rows show that a person is a real member (paid, enrolled, certified). Shown in red in a preview.
    var SENSITIVE_TABLES = ["credentials", "entitlements", "enrollments", "stripe_processed_sessions"];

    function renderCounts(container, data, highlight) {
      clear(container);
      if (data === null || data === undefined) return;
      var entries;
      if (Array.isArray(data)) {
        entries = data.map(function (item, i) {
          if (item && typeof item === "object") {
            var name = item.table || item.table_name || item.name || String(i + 1);
            var val = item.count !== undefined ? item.count : item.n !== undefined ? item.n : item.rows !== undefined ? item.rows : item;
            return [name, val];
          }
          return [String(i + 1), item];
        });
      } else if (typeof data === "object") {
        entries = Object.keys(data).map(function (k) { return [k, data[k]]; });
      } else {
        entries = [["result", data]];
      }
      if (!entries.length) { container.appendChild(h("p", { className: "ib-empty", text: "Nothing to show." })); return; }
      var tbody = h("tbody", {});
      entries.forEach(function (pair) {
        var v = pair[1];
        var shown = v !== null && typeof v === "object" ? JSON.stringify(v) : String(v);
        var warn = highlight && highlight.indexOf(pair[0]) >= 0 && Number(v) > 0;
        tbody.appendChild(h("tr", { className: warn ? "ib-warn-row" : "" }, h("td", { text: pair[0] }), h("td", { text: shown })));
      });
      container.appendChild(h("table", { className: "ib-table ib-counts" },
        h("thead", {}, h("tr", {}, h("th", { text: "Table" }), h("th", { text: "Rows" }))), tbody));
    }

    function buildCleanup() {
      var s = { people: [], selected: new Set(), previewKey: null, previewOk: false, previewWarning: "", hasPayments: 0, ticket: 0, junkKey: null };
      var message = h("p", { id: "cleanup-message", className: "ib-message", role: "status" });
      var query = h("input", { id: "people-query", type: "search", placeholder: "Name or email", label: "Search people" });
      var searchBtn = h("button", { id: "people-search-btn", type: "button", className: "ib-btn ib-primary", text: "Search people" });
      var flaggedBtn = h("button", { id: "people-flagged-btn", type: "button", className: "ib-btn", text: "Show flagged" });
      var selectFlaggedBtn = h("button", { id: "people-select-flagged", type: "button", className: "ib-btn", text: "Select all flagged shown" });
      var listWrap = h("div", { id: "people-list", className: "ib-table-wrap" });
      var selectedLabel = h("span", { id: "people-selected", className: "ib-count", text: "0 selected" });
      var previewBtn = h("button", { id: "people-preview", type: "button", className: "ib-btn", text: "Preview clean up" });
      var previewOut = h("div", { id: "people-preview-out" });
      var deleteBtn = h("button", { id: "people-delete", type: "button", className: "ib-btn ib-danger", text: "Delete selected test people" });
      var deleteBox = h("div", { id: "people-delete-box", className: "ib-confirm", hidden: true });
      var deleteText = h("p", { id: "people-delete-text" });
      var deleteInput = h("input", { id: "people-delete-input", type: "text", placeholder: "Type " + CONFIRM_WORD, label: "Type " + CONFIRM_WORD + " to confirm" });
      var deleteConfirm = h("button", { id: "people-delete-confirm", type: "button", className: "ib-btn ib-danger", text: "Delete permanently", disabled: true });
      var deleteCancel = h("button", { id: "people-delete-cancel", type: "button", className: "ib-btn", text: "Cancel" });
      var deleteOut = h("div", { id: "people-delete-out" });
      var deleteWho = h("ul", { id: "people-delete-who", className: "ib-who" });
      var deleteWarn = h("p", { id: "people-delete-warning", className: "ib-message ib-error" });
      deleteBox.appendChild(deleteText);
      deleteBox.appendChild(deleteWho);
      deleteBox.appendChild(deleteWarn);
      var allowPayments = h("input", { id: "people-allow-payments", type: "checkbox", checked: false });
      var allowRow = h("label", { id: "people-allow-payments-row", className: "ib-check ib-warn-check", hidden: true },
        allowPayments, h("span", { text: "Also delete purchase and access records for these people" }));
      deleteBox.appendChild(allowRow);
      deleteBox.appendChild(h("div", { className: "ib-row" }, deleteInput, deleteConfirm, deleteCancel));

      function selectionKey(list) { return list.slice().map(String).sort().join(","); }
      function flaggedShown() { return s.people.filter(function (p) { return p.is_test === true; }); }
      function updateSelectedLabel() {
        selectedLabel.textContent = s.selected.size + " selected";
        deleteBtn.disabled = s.selected.size === 0;
      }
      function updateDeleteGate() { deleteConfirm.disabled = deleteInput.value !== CONFIRM_WORD; }
      function closeDelete() { deleteBox.hidden = true; deleteInput.value = ""; allowPayments.checked = false; allowRow.hidden = true; updateDeleteGate(); }
      function invalidatePreview() { s.previewKey = null; s.previewOk = false; s.previewWarning = ""; s.hasPayments = 0; clear(previewOut); closeDelete(); }

      function renderPeople() {
        clear(listWrap);
        if (!s.people.length) {
          listWrap.appendChild(h("p", { className: "ib-empty", text: "No people to show. Search by name or email, or press Show flagged." }));
          return;
        }
        var tbody = h("tbody", {});
        s.people.forEach(function (person, index) {
          var pick = h("input", {
            type: "checkbox", id: "person-select-" + index, label: "Select this person", checked: s.selected.has(person.id),
            on: {
              change: function (e) {
                if (e.target.checked) s.selected.add(person.id); else s.selected.delete(person.id);
                updateSelectedLabel();
                invalidatePreview();
              }
            }
          });
          // The server refuses to flag staff or yourself; the box is off for them unless already flagged.
          var protectedPerson = (person.is_staff === true || person.is_self === true) && person.is_test !== true;
          var flag = h("input", { type: "checkbox", id: "person-test-" + index, label: "Test person", checked: person.is_test === true, disabled: protectedPerson });
          flag.addEventListener("change", function () {
            var wanted = Boolean(flag.checked);
            if (wanted && !askConfirm("Flag " + (person.email || person.display_name || "this person") + " as a test person? Test people can later be deleted together with their data.")) {
              flag.checked = false;
              return;
            }
            guarded(flag, message, async function () {
              await api.rpc("admin_set_person_test_flag", { p_person_ids: [person.id], p_is_test: wanted });
              person.is_test = wanted;
              invalidatePreview();
              setMessage(message, (person.email || person.display_name || "Person") + (wanted ? " flagged as test." : " no longer flagged as test."), "ok");
              renderPeople();
            }).then(function () { flag.checked = person.is_test === true; });
          });
          var nameCell = h("td", { text: shorten(person.display_name, 40) });
          if (person.is_self === true) nameCell.appendChild(h("span", { className: "ib-badge", text: "you" }));
          else if (person.is_staff === true) nameCell.appendChild(h("span", { className: "ib-badge", text: "staff" }));
          tbody.appendChild(h("tr", {},
            h("td", {}, pick),
            nameCell,
            h("td", { text: shorten(person.email, 50) }),
            h("td", {}, flag),
            h("td", { text: formatDate(person.created_at) }),
            h("td", { text: formatDate(person.last_activity_at) })));
        });
        listWrap.appendChild(h("table", { className: "ib-table" },
          h("thead", {}, h("tr", {}, h("th", { text: "" }), h("th", { text: "Name" }), h("th", { text: "Email" }),
            h("th", { text: "Test" }), h("th", { text: "Created" }), h("th", { text: "Last activity" }))), tbody));
      }

      async function loadPeople(q, onlyFlagged) {
        var ticket = ++s.ticket;
        setMessage(message, "Loading...", "");
        var data = await api.rpc("admin_people_search", { p_query: q, p_limit: 100, p_only_test: onlyFlagged === true });
        if (ticket !== s.ticket) return null;
        var rows = Array.isArray(data) ? data : (data && Array.isArray(data.rows) ? data.rows : []);
        if (onlyFlagged) rows = rows.filter(function (p) { return p && p.is_test === true; });
        return rows;
      }

      async function showPeople(q, onlyFlagged, button) {
        await guarded(button, message, async function () {
          var rows = await loadPeople(q, onlyFlagged);
          if (rows === null) return;
          s.people = rows;
          var present = new Set(rows.map(function (p) { return p.id; }));
          s.selected.forEach(function (id) { if (!present.has(id)) s.selected.delete(id); });
          invalidatePreview();
          renderPeople();
          updateSelectedLabel();
          setMessage(message, rows.length + (rows.length === 1 ? " person." : " people.") + (rows.length >= 100 ? " Only the first 100 are shown; narrow the search." : ""), "");
        });
      }

      function renderPreview(res) {
        clear(previewOut);
        var counts = res && typeof res === "object" && res.counts && typeof res.counts === "object" ? res.counts : res;
        var blocked = res && typeof res === "object" && res.blocked && typeof res.blocked === "object" ? res.blocked : {};
        var reasons = [];
        var labels = { not_found: "do not exist", not_test: "are not flagged as test", platform_role: "hold a platform role", caller: "are you" };
        // has_payments does not block: the purge goes ahead only when the owner also ticks the payments box.
        s.hasPayments = Number(blocked.has_payments) > 0 ? Number(blocked.has_payments) : 0;
        Object.keys(blocked).forEach(function (k) {
          if (k !== "has_payments" && Number(blocked[k]) > 0) reasons.push(blocked[k] + " " + (labels[k] || k));
        });
        var selected = res && typeof res === "object" && res.selected !== undefined ? Number(res.selected) : null;
        var max = res && typeof res === "object" && Number(res.max_per_purge) > 0 ? Number(res.max_per_purge) : MAX_PURGE_PEOPLE;
        if (selected !== null) {
          previewOut.appendChild(h("p", { id: "people-preview-summary", className: "ib-hint",
            text: selected + " people in this preview (" + max + " at most per delete)." + (reasons.length ? " Blocked: " + reasons.join(", ") + "." : "") }));
        }
        // Real member data is a sign that a person may not be a test person at all.
        var found = [];
        if (counts && typeof counts === "object") {
          SENSITIVE_TABLES.forEach(function (t) { if (Number(counts[t]) > 0) found.push(counts[t] + " " + t.replace(/_/g, " ")); });
        }
        s.previewWarning = found.length
          ? "Warning: these people have " + found.join(", ") + ". Real members have these. Check that every person listed is really a test person."
          : "";
        if (s.hasPayments > 0) {
          // The preview does not say which people; the count is all the data gives.
          previewOut.appendChild(h("p", { id: "people-preview-payments", className: "ib-message ib-error", role: "alert",
            text: s.hasPayments + " selected " + (s.hasPayments === 1 ? "person has" : "people have") +
              " purchases or access records. Deleting them removes those records." }));
        }
        if (s.previewWarning) previewOut.appendChild(h("p", { id: "people-preview-warning", className: "ib-message ib-error", role: "alert", text: s.previewWarning }));
        renderCountsInto(previewOut, counts);
        s.previewOk = reasons.length === 0 && (selected === null || (selected >= 1 && selected <= max));
      }

      function renderCountsInto(container, data) {
        var holder = h("div", {});
        renderCounts(holder, data, SENSITIVE_TABLES);
        container.appendChild(holder);
      }

      async function preview() {
        await guarded(previewBtn, message, async function () {
          var list = idsOf(s.selected);
          if (list.length > MAX_IDS) { setMessage(message, "Too many people (" + list.length + "). Select at most " + MAX_IDS + ".", "error"); return; }
          // With nobody selected the server previews every person flagged as test.
          var res = await api.rpc("admin_cleanup_preview", { p_person_ids: list.length ? list : null });
          s.previewKey = list.length ? selectionKey(list) : null;
          renderPreview(res);
          if (!list.length) s.previewOk = false; // all flagged is a look only; select people to delete them
          setMessage(message, (list.length ? "Preview for the selected people." : "Preview for all people flagged as test.") + " Nothing was deleted.", "ok");
        });
      }

      function startDelete() {
        var list = idsOf(s.selected);
        if (!list.length) { setMessage(message, "Select at least one person first.", "error"); return; }
        var notTest = list.filter(function (id) {
          return !s.people.some(function (p) { return p.id === id && p.is_test === true; });
        });
        if (notTest.length) {
          setMessage(message, "Only people flagged as test can be deleted. Flag them as test, or untick them.", "error");
          return;
        }
        if (list.length > MAX_PURGE_PEOPLE) { setMessage(message, "Select at most " + MAX_PURGE_PEOPLE + " people at a time.", "error"); return; }
        if (s.previewKey !== selectionKey(list)) {
          setMessage(message, "Press Preview clean up for this selection first, and read the counts.", "error");
          return;
        }
        if (!s.previewOk) {
          setMessage(message, "The preview shows people who cannot be deleted. Untick them and preview again.", "error");
          return;
        }
        deleteText.textContent = "This permanently removes these " + list.length + " test " + (list.length === 1 ? "person" : "people") +
          " and their data from Supabase. It cannot be undone. Type " + CONFIRM_WORD + " to confirm.";
        clear(deleteWho);
        var shownPeople = list.slice(0, 20);
        shownPeople.forEach(function (id) {
          var person = s.people.filter(function (p) { return p.id === id; })[0] || {};
          deleteWho.appendChild(h("li", { text: shorten(person.display_name || "(no name)", 60) + " - " + shorten(person.email || "(no email)", 80) }));
        });
        if (list.length > shownPeople.length) deleteWho.appendChild(h("li", { text: "and " + (list.length - shownPeople.length) + " more" }));
        deleteWarn.textContent = (s.hasPayments > 0
          ? s.hasPayments + " of these people have purchases or access records. Deleting them removes those records. " : "") + s.previewWarning;
        allowPayments.checked = false;
        allowRow.hidden = s.hasPayments === 0;
        deleteBox.hidden = false;
        deleteInput.value = "";
        updateDeleteGate();
      }

      async function confirmDelete() {
        if (deleteInput.value !== CONFIRM_WORD) { setMessage(message, "Type " + CONFIRM_WORD + " to delete.", "error"); return; }
        var list = idsOf(s.selected);
        if (!list.length || list.length > MAX_PURGE_PEOPLE || !s.previewOk || s.previewKey !== selectionKey(list)) {
          setMessage(message, "Press Preview clean up for this selection first.", "error");
          closeDelete();
          return;
        }
        if (s.hasPayments > 0 && !allowPayments.checked) {
          setMessage(message, "Some of these people have purchases or access records. Tick the box to delete those records too, or untick those people.", "error");
          return;
        }
        var purgeArgs = { p_person_ids: list, p_confirm: CONFIRM_WORD };
        if (s.hasPayments > 0 && allowPayments.checked) purgeArgs.p_allow_payments = true;
        await guarded(deleteConfirm, message, async function () {
          var res = await api.rpc("admin_cleanup_purge_people", purgeArgs);
          renderCounts(deleteOut, res && res.counts ? res.counts : res);
          var gone = new Set(list);
          s.people = s.people.filter(function (p) { return !gone.has(p.id); });
          s.selected.clear();
          invalidatePreview();
          renderPeople();
          updateSelectedLabel();
          setMessage(message, "Deleted " + list.length + " test " + (list.length === 1 ? "person" : "people") + ". Rows removed per table are listed below.", "ok");
        }, function () { invalidatePreview(); });
      }

      searchBtn.addEventListener("click", function () { showPeople(String(query.value || "").trim().slice(0, 200), false, searchBtn); });
      query.addEventListener("keydown", function (e) { if (e.key === "Enter") showPeople(String(query.value || "").trim().slice(0, 200), false, searchBtn); });
      flaggedBtn.addEventListener("click", function () { showPeople("", true, flaggedBtn); });
      selectFlaggedBtn.addEventListener("click", function () {
        flaggedShown().forEach(function (p) { s.selected.add(p.id); });
        invalidatePreview();
        renderPeople();
        updateSelectedLabel();
      });
      previewBtn.addEventListener("click", preview);
      deleteBtn.addEventListener("click", startDelete);
      deleteInput.addEventListener("input", updateDeleteGate);
      deleteConfirm.addEventListener("click", confirmDelete);
      deleteCancel.addEventListener("click", closeDelete);

      // Junk events
      var junkMessage = h("p", { id: "junk-message", className: "ib-message", role: "status" });
      var junkKind = h("select", { id: "junk-kind", label: "Event kind" },
        h("option", { text: "Browser error events (stability)", value: "stability" }),
        h("option", { text: "Member activity history (real members, older than N days)", value: "engagement" }));
      junkKind.value = "stability";
      var junkDays = h("input", { id: "junk-days", type: "number", min: 1, max: MAX_DAYS, value: "30", label: "Older than days" });
      var junkTypes = h("input", { id: "junk-types", type: "text", placeholder: JUNK_TYPES.stability.join(", "), label: "Event types" });
      var junkDry = h("button", { id: "junk-dry", type: "button", className: "ib-btn", text: "Dry run (count only)" });
      var junkInput = h("input", { id: "junk-input", type: "text", placeholder: "Type " + CONFIRM_WORD, label: "Type " + CONFIRM_WORD + " to confirm" });
      var junkRun = h("button", { id: "junk-run", type: "button", className: "ib-btn ib-danger", text: "Delete matching events", disabled: true });
      var junkConfirmRow = h("div", { className: "ib-row", hidden: true }, junkInput, junkRun);

      // The server accepts 1 day or more; real member activity history needs at least 30 here.
      function junkMinDays() { return junkKind.value === "engagement" ? MIN_ENGAGEMENT_DAYS : 1; }
      function junkParams() {
        var days = parseDays(junkDays.value, junkMinDays());
        var types = parseTypes(junkTypes.value, junkKind.value);
        if (days === null || types === null) return null;
        return { p_kind: junkKind.value, p_older_than_days: days, p_types: types.length ? types : null };
      }
      function junkSignature() {
        var p = junkParams();
        return p ? p.p_kind + "|" + p.p_older_than_days + "|" + (p.p_types ? p.p_types.join(",") : "") : null;
      }
      function updateJunkGate() { junkRun.disabled = !(s.junkKey !== null && s.junkKey === junkSignature() && junkInput.value === CONFIRM_WORD); }
      function resetJunk() { s.junkKey = null; junkConfirmRow.hidden = true; junkInput.value = ""; updateJunkGate(); }

      junkDry.addEventListener("click", async function () {
        var p = junkParams();
        if (!p) { setMessage(junkMessage, "Enter a number of days from " + junkMinDays() + " to " + MAX_DAYS + ", and only event types for this kind: " + JUNK_TYPES[junkKind.value].join(", ") + ".", "error"); return; }
        await guarded(junkDry, junkMessage, async function () {
          var res = await api.rpc("admin_cleanup_junk_events", {
            p_kind: p.p_kind, p_older_than_days: p.p_older_than_days, p_types: p.p_types, p_dry_run: true
          });
          var matched = Number(res && res.matched) || 0;
          s.junkKey = junkSignature();
          junkInput.value = "";
          junkConfirmRow.hidden = matched === 0;
          setMessage(junkMessage, matched + " " + p.p_kind + " events match. Nothing was deleted." + (matched ? " To delete them, type " + CONFIRM_WORD + " and press the red button." : ""), "ok");
          updateJunkGate();
        });
      });
      junkRun.addEventListener("click", async function () {
        var p = junkParams();
        if (!p || s.junkKey === null || s.junkKey !== junkSignature()) {
          setMessage(junkMessage, "Run the dry run again: the settings changed.", "error");
          resetJunk();
          return;
        }
        if (junkInput.value !== CONFIRM_WORD) { setMessage(junkMessage, "Type " + CONFIRM_WORD + " to delete.", "error"); return; }
        await guarded(junkRun, junkMessage, async function () {
          var res = await api.rpc("admin_cleanup_junk_events", {
            p_kind: p.p_kind, p_older_than_days: p.p_older_than_days, p_types: p.p_types, p_dry_run: false
          });
          resetJunk();
          setMessage(junkMessage, (Number(res && res.deleted) || 0) + " events deleted.", "ok");
        }, function () { resetJunk(); });
      });
      junkInput.addEventListener("input", updateJunkGate);
      junkKind.addEventListener("change", function () {
        junkTypes.setAttribute("placeholder", JUNK_TYPES[junkKind.value].join(", "));
        junkDays.setAttribute("min", String(junkMinDays()));
      });
      [junkKind, junkDays, junkTypes].forEach(function (c) {
        c.addEventListener("input", resetJunk);
        c.addEventListener("change", resetJunk);
      });

      var panel = h("section", { id: "cleanup-panel", className: "ib-panel", role: "tabpanel", hidden: true },
        h("p", { className: "ib-note", text: "This removes data from Supabase only. Test data in Firebase is removed with the existing member tools until Firebase is retired." }),
        h("h3", { text: "Test people" }),
        h("div", { className: "ib-row ib-filters" }, labeled("Name or email", query, "ib-grow"), searchBtn, flaggedBtn),
        message,
        listWrap,
        h("div", { className: "ib-row" }, selectedLabel, selectFlaggedBtn, previewBtn, deleteBtn),
        previewOut,
        deleteBox,
        deleteOut,
        h("h3", { text: "Junk events" }),
        h("p", { className: "ib-hint", text: "Old technical events that are no longer useful. Leave the types empty for all of them. Run the dry run first; it only counts." }),
        h("div", { className: "ib-row ib-filters" },
          labeled("Kind", junkKind), labeled("Older than (days)", junkDays), labeled("Event types (optional)", junkTypes, "ib-grow"), junkDry),
        junkMessage, junkConfirmRow);

      updateSelectedLabel();
      return { panel: panel, ensureLoaded: function () { return Promise.resolve(); }, state: s };
    }

    // -------------------------------------------------------------------------
    // Shell

    function mount(rootNode) {
      var leads = buildInbox("leads");
      var feedback = buildInbox("feedback");
      var cleanup = buildCleanup();
      var tabs = [
        { id: "tab-leads", label: "Leads", view: leads },
        { id: "tab-feedback", label: "Feedback", view: feedback },
        { id: "tab-cleanup", label: "Data clean up", view: cleanup }
      ];
      var tabBar = h("div", { className: "ib-tabs", role: "tablist" });
      function select(index) {
        tabs.forEach(function (t, i) {
          t.button.setAttribute("aria-selected", i === index ? "true" : "false");
          t.button.className = "ib-tab" + (i === index ? " is-active" : "");
          t.view.panel.hidden = i !== index;
        });
        var result = tabs[index].view.ensureLoaded();
        return result;
      }
      tabs.forEach(function (t, i) {
        t.button = h("button", { id: t.id, type: "button", role: "tab", className: "ib-tab", text: t.label });
        t.button.addEventListener("click", function () { select(i); });
        tabBar.appendChild(t.button);
      });
      shell.main = h("div", { className: "ib-main" }, tabBar, leads.panel, feedback.panel, cleanup.panel);
      clear(rootNode);
      rootNode.appendChild(shell.main);
      return select(0);
    }

    return { mount: mount, state: state, views: shell };
  }

  // ---------------------------------------------------------------------------
  // Browser start

  function browserDownload(filename, text) {
    var blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.setAttribute("href", url);
    a.setAttribute("download", filename);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // rootNode: the element to fill. options.getToken(forceRefresh): the admin's Firebase ID token, or "" when
  // nobody is signed in.
  function start(rootNode, options) {
    var api = createApi({
      fetchImpl: options.fetchImpl || function () { return root.fetch.apply(root, arguments); },
      getToken: options.getToken
    });
    var inbox = createInbox({
      document: options.document || root.document,
      api: api,
      download: options.download || browserDownload,
      confirm: options.confirm || function (text) { return typeof root.confirm === "function" ? root.confirm(text) : false; }
    });
    return inbox.mount(rootNode).then(function () { return inbox; });
  }

  var exported = {
    start: start,
    createInbox: createInbox,
    createApi: createApi,
    chunk: chunk,
    csvCell: csvCell,
    toCsv: toCsv,
    isNoAccess: isNoAccess,
    constants: { PAGE_SIZE: PAGE_SIZE, MAX_IDS: MAX_IDS, CONFIRM_WORD: CONFIRM_WORD, NO_ACCESS_TEXT: NO_ACCESS_TEXT }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
  if (root) root.UTLInbox = exported;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
