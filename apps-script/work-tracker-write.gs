/**
 * Bread Work — write-back web app for the Work Tracker sheet.
 * Companion to work-tracker.html (BreadchainCoop/decks).
 *
 * Deploy (see README in this folder):
 *   1. Open the Work Tracker sheet → Extensions → Apps Script
 *   2. Paste this file over Code.gs
 *   3. Set the TOKEN below to a long random string
 *   4. Deploy → New deployment → Web app
 *        Execute as:  Me
 *        Who has access: Anyone
 *   5. Copy the /exec URL + your TOKEN into work-tracker.html:
 *        const WRITE_URL = "https://script.google.com/macros/s/…/exec";
 *        const WRITE_TOKEN = "…";
 *
 * Contract (POST, Content-Type: text/plain;charset=utf-8, JSON body):
 *   { token, op:"update", row, task, patch:{ "<Column header>": "<value>" } }
 *   { token, op:"add",    fields:{ "<Column header>": "<value>" } }
 * Response: { ok:true, ... } or { ok:false, error:"…" }
 *
 * Every successful write appends a row to the History tab.
 */

/* ── configure ───────────────────────────────────────────────────────── */
var SPREADSHEET_ID = "10vQRSVpiePANd1yNzSyua_PO5DCgk9muB_VqYIFDAkE";
var TOKEN = "CHANGE-ME-work-tracker-6f3a91c05b7e4421";

var TASKS_SHEET = "Tasks";
var HIST_SHEET = "History";

/* headers the tracker needs. Missing ones are appended automatically. */
var REQUIRED_HEADERS = ["Task", "Project", "Owner", "Status", "Priority", "Due",
                        "Contact / Org", "Grant", "KB link", "Notes",
                        "Blocked by", "Subtasks", "Start"];

/* only these columns may be written — never let a caller invent columns */
var WRITABLE = {};
REQUIRED_HEADERS.forEach(function (h) { WRITABLE[h.toLowerCase()] = h; });

/* ── helpers ─────────────────────────────────────────────────────────── */
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function fail(msg) { return json({ ok: false, error: String(msg) }); }

function sheetByName(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('no sheet named "' + name + '"');
  return sh;
}

/** header text -> 1-based column index (and appends any missing REQUIRED_HEADERS) */
function headerMap(sh) {
  var last = Math.max(sh.getLastColumn(), 1);
  var row = sh.getRange(1, 1, 1, last).getValues()[0];
  var map = {};
  row.forEach(function (h, i) { if (h !== "") map[String(h).trim().toLowerCase()] = i + 1; });

  var missing = REQUIRED_HEADERS.filter(function (h) { return !map[h.toLowerCase()]; });
  if (missing.length) {
    var start = row.length;
    var add = [];
    missing.forEach(function (h) { add.push(h); });
    /* drop trailing empty header cells so we append in order */
    while (start > 0 && (row[start - 1] === "" || row[start - 1] == null)) start--;
    sh.getRange(1, start + 1, 1, add.length).setValues([add]);
    add.forEach(function (h, i) { map[h.toLowerCase()] = start + 1 + i; });
  }
  return map;
}

/** locate the task row: prefer the given row number when the Task text matches,
 *  otherwise search by exact Task title. Returns 1-based row index or -1. */
function findRow(sh, map, rowHint, taskText) {
  var col = map["task"];
  if (!col) return -1;
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;

  if (rowHint) {
    var r = Number(rowHint);
    if (r >= 2 && r <= lastRow) {
      var v = String(sh.getRange(r, col).getValue() || "").trim();
      if (!taskText || v === String(taskText).trim()) return r;
    }
  }
  if (!taskText) return -1;
  var values = sh.getRange(2, col, lastRow - 1, 1).getValues();
  var want = String(taskText).trim().toLowerCase();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || "").trim().toLowerCase() === want) return i + 2;
  }
  return -1;
}

function logHistory(ss, op, task, detail, by) {
  var sh = ss.getSheetByName(HIST_SHEET);
  if (!sh) {
    sh = ss.insertSheet(HIST_SHEET);
    sh.appendRow(["Timestamp", "Op", "Task", "Detail", "By"]);
  }
  sh.appendRow([new Date(), op, task || "", detail || "", by || "web"]);
}

/* ── handlers ────────────────────────────────────────────────────────── */
function doGet(e) {
  return json({ ok: true, service: "bread-work-tracker", hint: "POST JSON with a token" });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return fail("body is not JSON");
  }
  if (!TOKEN || body.token !== TOKEN) return fail("bad token");

  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sh = sheetByName(ss, TASKS_SHEET);
    var map = headerMap(sh);

    if (body.op === "update") {
      var patch = body.patch || {};
      var keys = Object.keys(patch);
      if (!keys.length) return fail("empty patch");

      var row = findRow(sh, map, body.row, body.task);
      if (row < 0) return fail("task row not found");

      var changed = [];
      keys.forEach(function (k) {
        var header = WRITABLE[String(k).trim().toLowerCase()];
        if (!header) { changed.push("skipped unknown column: " + k); return; }
        var col = map[header.toLowerCase()];
        sh.getRange(row, col).setValue(patch[k]);
        changed.push(header + " → " + patch[k]);
      });

      var taskName = String(sh.getRange(row, map["task"]).getValue() || body.task || "");
      logHistory(ss, "update", taskName, changed.join("; "), body.by || "deck");
      return json({ ok: true, row: row, changed: changed });
    }

    if (body.op === "add") {
      var fields = body.fields || {};
      if (!String(fields["Task"] || "").trim()) return fail("a new task needs a Task value");

      var width = sh.getLastColumn() || REQUIRED_HEADERS.length;
      var out = new Array(width).fill("");
      Object.keys(fields).forEach(function (k) {
        var header = WRITABLE[String(k).trim().toLowerCase()];
        if (!header) return;
        var col = map[header.toLowerCase()];
        if (col <= width) out[col - 1] = fields[k];
      });
      sh.appendRow(out);
      var newRow = sh.getLastRow();
      logHistory(ss, "create", fields["Task"], "added via deck", body.by || "deck");
      return json({ ok: true, row: newRow });
    }

    return fail("unknown op: " + body.op);
  } catch (err) {
    return fail(err && err.message ? err.message : err);
  }
}
