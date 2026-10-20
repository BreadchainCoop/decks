/**
 * Bread automations — shared helpers + Agent Inbox.
 *
 * Paste this as a separate file in the Work Tracker Apps Script project,
 * alongside work-tracker-write.gs and the job files. Everything lives under
 * the `Bh` namespace so it cannot collide with the write app's globals.
 *
 * Design rules (see OVERVIEW.md §4):
 *   - jobs are idempotent and silent when nothing changed
 *   - one compact event per source/kind, only when its signature changes
 *   - a condition that clears resets the signature, so recurrence notifies
 */

var Bh = (function () {
  var WORK_SS_ID = "10vQRSVpiePANd1yNzSyua_PO5DCgk9muB_VqYIFDAkE";
  var CONTRIB_SS_ID = "1ncGbPZyf0vH9NCsndvaUkmkJremWz1YW1_-YPpLRjxA";
  var CRM_FEED_ID = "19Lxe0C14BOYbOj0Z0nyoQc4-I_aw_jgybcq9LggfcUw";
  var CRM_GID_CONTACTS = 1045890393;

  var INBOX_SHEET = "Agent Inbox";
  var INBOX_HEADERS = ["Timestamp", "Source", "Kind", "Severity", "Ref", "Summary", "Payload", "Handled"];

  /* ── properties / serialisation ─────────────────────────────────────── */
  function prop(key, dflt) {
    var v = PropertiesService.getScriptProperties().getProperty(key);
    return (v === null || v === "") ? dflt : v;
  }
  function setProp(key, value) {
    PropertiesService.getScriptProperties().setProperty(key, String(value));
  }
  function delProp(key) {
    PropertiesService.getScriptProperties().deleteProperty(key);
  }
  function json(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj))
      .setMimeType(ContentService.MimeType.JSON);
  }
  function fail(msg) { return json({ ok: false, error: String(msg) }); }

  /* ── dates ──────────────────────────────────────────────────────────── */
  function today() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function fmtDate(d) {
    if (!d) return "";
    return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  /** Date | ISO | yyyy-mm-dd | d/m/yyyy | m/d/yyyy | gviz Date(y,m,d) */
  function parseDate(v) {
    if (v === null || v === undefined || v === "") return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    var s = String(v).trim();
    var m = s.match(/^Date\((\d+),(\d+),(\d+)/);
    if (m) return new Date(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/);
    if (m) {
      /* day-first when the first part cannot be a month */
      var a = +m[1], b = +m[2];
      return a > 12 ? new Date(+m[3], b - 1, a) : new Date(+m[3], a - 1, b);
    }
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  function daysSince(d) {
    if (!d) return null;
    return Math.round((today() - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  }

  /* ── sheets ─────────────────────────────────────────────────────────── */
  /** header text (trimmed, lowercased) -> 1-based column. Missing required
   *  headers are appended only when `addMissing` is true. */
  function headerMap(sh, required, addMissing) {
    var last = Math.max(sh.getLastColumn(), 1);
    var head = sh.getRange(1, 1, 1, last).getValues()[0]
      .map(function (h) { return String(h).trim().toLowerCase(); });
    var map = {};
    head.forEach(function (h, i) { if (h && map[h] === undefined) map[h] = i + 1; });
    if (addMissing && required) {
      var next = sh.getLastColumn();
      required.forEach(function (h) {
        var k = String(h).trim().toLowerCase();
        if (map[k]) return;
        next++;
        sh.getRange(1, next).setValue(h);
        map[k] = next;
      });
    }
    return map;
  }
  function col(map, name) {
    return map[String(name).trim().toLowerCase()] || 0;
  }
  function sheetById(ss, gid) {
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (String(sheets[i].getSheetId()) === String(gid)) return sheets[i];
    }
    return null;
  }
  function sheetByRegex(ss, re) {
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (re.test(sheets[i].getName())) return sheets[i];
    }
    return null;
  }
  /** read a tab into objects keyed by lowercased header; skips fully empty rows */
  function readRows(sh) {
    var last = sh.getLastRow();
    if (last < 2) return { map: headerMap(sh, [], false), rows: [] };
    var map = headerMap(sh, [], false);
    var width = Math.max(sh.getLastColumn(), 1);
    var values = sh.getRange(2, 1, last - 1, width).getValues();
    var rows = values.map(function (r, i) {
      var o = { __row: i + 2 };
      Object.keys(map).forEach(function (k) { o[k] = r[map[k] - 1]; });
      return o;
    }).filter(function (o) {
      return Object.keys(o).some(function (k) {
        return k !== "__row" && String(o[k] === null || o[k] === undefined ? "" : o[k]).trim() !== "";
      });
    });
    return { map: map, rows: rows };
  }

  /* ── Agent Inbox ────────────────────────────────────────────────────── */
  function ensureInbox(ss) {
    var sh = ss.getSheetByName(INBOX_SHEET);
    if (!sh) {
      sh = ss.insertSheet(INBOX_SHEET);
      sh.appendRow(INBOX_HEADERS);
      sh.getRange(1, 1, 1, INBOX_HEADERS.length).setFontWeight("bold");
      sh.setFrozenRows(1);
    } else if (sh.getLastRow() < 1) {
      sh.appendRow(INBOX_HEADERS);
    }
    return sh;
  }
  function appendEvent(e) {
    var sh = ensureInbox(inboxBook());
    sh.appendRow([
      new Date(),
      e.source || "",
      e.kind || "",
      e.severity || "info",
      e.ref || "",
      e.summary || "",
      JSON.stringify(e.payload || {}),
      ""
    ]);
    return sh.getLastRow();
  }
  /** the one inbox lives in the Work Tracker, whatever sheet the job reads */
  function inboxBook() {
    return SpreadsheetApp.openById(WORK_SS_ID);
  }

  /**
   * Emit one event for source/kind, but only when `sig` differs from the last
   * emitted signature. Returns true when a row was written.
   */
  function notify(e) {
    var key = "sig:" + e.source + ":" + e.kind;
    var sig = e.sig || JSON.stringify(e.payload || {});
    if (sig === prop(key, "")) return false;
    appendEvent(e);
    setProp(key, sig);
    return true;
  }
  /** the condition cleared — next occurrence should notify again */
  function clear(source, kind) {
    delProp("sig:" + source + ":" + kind);
  }

  function withLock(fn) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return false;
    try { return fn(); }
    finally { lock.releaseLock(); }
  }

  function digestLine(parts) {
    return parts.filter(function (p) { return p; }).join(" · ");
  }

  return {
    WORK_SS_ID: WORK_SS_ID,
    CONTRIB_SS_ID: CONTRIB_SS_ID,
    CRM_FEED_ID: CRM_FEED_ID,
    CRM_GID_CONTACTS: CRM_GID_CONTACTS,
    INBOX_SHEET: INBOX_SHEET,
    INBOX_HEADERS: INBOX_HEADERS,
    prop: prop, setProp: setProp, delProp: delProp,
    json: json, fail: fail,
    today: today, fmtDate: fmtDate, parseDate: parseDate, daysSince: daysSince,
    headerMap: headerMap, col: col, sheetById: sheetById, sheetByRegex: sheetByRegex, readRows: readRows,
    ensureInbox: ensureInbox, appendEvent: appendEvent, notify: notify, clear: clear,
    withLock: withLock, digestLine: digestLine
  };
})();
