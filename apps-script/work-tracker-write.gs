/**
 * Bread Work — write-back web app for the Work Tracker sheet, and the write
 * endpoint for contributor-dashboard.html.
 * Companion to work-tracker.html + contributor-dashboard.html
 * (BreadchainCoop/decks).
 *
 * Deploy (see README in this folder):
 *   1. Open the Work Tracker sheet → Extensions → Apps Script
 *   2. Paste this file over Code.gs
 *   3. Set the TOKEN below to a long random string
 *   4. Deploy → New deployment → Web app
 *        Execute as:  Me
 *        Who has access: Anyone
 *   5. Copy the /exec URL + your TOKEN into the decks:
 *        const WRITE_URL = "https://script.google.com/macros/s/…/exec";
 *        const WRITE_TOKEN = "…";
 *
 * Contract (POST, Content-Type: text/plain;charset=utf-8, JSON body):
 *   { token, op:"update", row, task, patch:{ "<Column header>": "<value>" } }
 *   { token, op:"add",    fields:{ "<Column header>": "<value>" } }
 *   { token, op:"contributor.update", signupRow, name, timestampMs,
 *     patch:{ "Status"|"Contact person"|"Value aligned"|… } }
 *   { token, op:"contributor.assign", signupRow, name, timestampMs, owner,
 *     task:{ "Task", "Project", "Owner", "Status", "Priority", "Due",
 *            "Contact / Org", "Notes" } }
 * Response: { ok:true, ... } or { ok:false, error:"…" }
 *
 * Every successful work-tracker write appends a row to the History tab.
 * Contributor ops write the interest-form sheet and upsert one Work Tracker
 * task (matched by the [ctr:…] marker in Notes) — one deployment, one token.
 */

/* ── configure ───────────────────────────────────────────────────────── */
var SPREADSHEET_ID = "10vQRSVpiePANd1yNzSyua_PO5DCgk9muB_VqYIFDAkE";
var TOKEN = "CHANGE-ME-work-tracker-6f3a91c05b7e4421";

var TASKS_SHEET = "Tasks";
var HIST_SHEET = "History";

/* Contributor interest form (read by contributor-dashboard.html). */
var CONTRIB_SPREADSHEET_ID = "1ncGbPZyf0vH9NCsndvaUkmkJremWz1YW1_-YPpLRjxA";
var CONTRIB_TAB_RE = /^new form responses/i;

/* canonical field → acceptable sheet headers (trimmed, lowercased) */
var CONTRIB_COLUMNS = {
  "status": ["status"],
  "contact person": ["contact perons in bc core", "contact person in bc core", "contact person"],
  "value aligned": ["value aligned"],
  "skills needed": ["skills needed"],
  "vibe": ["vibe"],
  "reliability": ["reliability"],
  "others": ["others"]
};
var CONTRIB_APPEND = ["Value aligned", "Skills needed", "Vibe", "Reliability", "Others"];

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
function safeSheetValue_(value) {
  return typeof value === "string" && value.charAt(0) === "=" ? "'" + value : value;
}

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
  sh.appendRow([new Date(), op, task || "", detail || "", by || "web"].map(safeSheetValue_));
}

/* ── contributor dashboard: interest form + outreach task ────────────── */
function contribSheet_(ss) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (CONTRIB_TAB_RE.test(sheets[i].getName())) return sheets[i];
  }
  throw new Error("no live form tab found (expected a tab starting with \"New Form Responses\")");
}

/** canonical field -> 1-based column; appends the eval columns if missing */
function contribHeaderMap_(sh) {
  var last = Math.max(sh.getLastColumn(), 1);
  var head = sh.getRange(1, 1, 1, last).getValues()[0]
    .map(function (h) { return String(h).trim().toLowerCase(); });
  var map = {};
  Object.keys(CONTRIB_COLUMNS).forEach(function (field) {
    var aliases = CONTRIB_COLUMNS[field];
    for (var i = 0; i < head.length; i++) {
      if (aliases.indexOf(head[i]) >= 0) { map[field] = i + 1; break; }
    }
  });
  var next = sh.getLastColumn();
  CONTRIB_APPEND.forEach(function (h) {
    var key = h.toLowerCase();
    if (map[key]) return;
    next++;
    sh.getRange(1, next).setValue(h);
    map[key] = next;
  });
  if (!map["contact person"]) {
    next++;
    sh.getRange(1, next).setValue("Contact perons in BC core");
    map["contact person"] = next;
  }
  return map;
}

/** locate the signup: prefer the row hint, but verify name + timestamp */
function findSignupRow_(sh, hint, name, timestampMs) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var vals = sh.getRange(2, 1, last - 1, 2).getValues();
  var want = String(name || "").trim().toLowerCase();
  function hit(i) {
    var n = String(vals[i][1] || "").trim().toLowerCase();
    if (want && n !== want) return false;
    if (timestampMs) {
      var d = vals[i][0];
      var t = (d instanceof Date) ? d.getTime() : new Date(d).getTime();
      if (isFinite(t) && Math.abs(t - Number(timestampMs)) > 120000) return false;
    }
    return true;
  }
  if (hint) {
    var r = Number(hint);
    if (r >= 2 && r <= last && hit(r - 2)) return r;
  }
  for (var i = 0; i < vals.length; i++) if (hit(i)) return i + 2;
  return -1;
}

function contribWrite_(sh, map, row, patch) {
  var changed = [];
  Object.keys(patch || {}).forEach(function (k) {
    var field = String(k).trim().toLowerCase();
    if (!CONTRIB_COLUMNS[field]) {
      /* accept the sheet's own header text too ("Contact perons in BC core") */
      Object.keys(CONTRIB_COLUMNS).forEach(function (f) {
        if (CONTRIB_COLUMNS[f].indexOf(field) >= 0) field = f;
      });
    }
    var col = map[field];
    if (!col) { changed.push("skipped unknown column: " + k); return; }
    sh.getRange(row, col).setValue(safeSheetValue_(patch[k]));
    changed.push(field + " → " + patch[k]);
  });
  return changed;
}

function handleContributor_(body) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return fail("busy — try again");
  try {
    var cSS = SpreadsheetApp.openById(CONTRIB_SPREADSHEET_ID);
    var sh = contribSheet_(cSS);
    var map = contribHeaderMap_(sh);
    var row = findSignupRow_(sh, body.signupRow, body.name, body.timestampMs);
    if (row < 0) return fail("signup row not found — refresh the dashboard");

    if (body.op === "contributor.update") {
      return json({ ok: true, signupRow: row, changed: contribWrite_(sh, map, row, body.patch || {}) });
    }

    if (body.op === "contributor.assign") {
      var owner = String(body.owner || "").trim();
      var task = body.task || {};
      var marker = String(task["Notes"] || "").split(" ")[0] || "";
      if (!/^\[ctr:/.test(marker)) return fail("task notes must start with a [ctr:…] marker");
      contribWrite_(sh, map, row, { "Contact person": owner });

      var workSS = SpreadsheetApp.openById(SPREADSHEET_ID);
      var tasks = sheetByName(workSS, TASKS_SHEET);
      var tmap = headerMap(tasks);
      var notesCol = tmap["notes"], ownerCol = tmap["owner"], statusCol = tmap["status"];
      var found = -1;
      var lastRow = tasks.getLastRow();
      if (lastRow >= 2) {
        var notes = tasks.getRange(2, notesCol, lastRow - 1, 1).getValues();
        for (var i = 0; i < notes.length; i++) {
          if (String(notes[i][0] || "").indexOf(marker) >= 0) { found = i + 2; break; }
        }
      }

      if (found > 0) {
        tasks.getRange(found, ownerCol).setValue(safeSheetValue_(owner));
        if (!String(tasks.getRange(found, statusCol).getValue() || "").trim()) {
          tasks.getRange(found, statusCol).setValue("Backlog");
        }
        logHistory(workSS, "update", String(task["Task"] || ""), "contributor owner → " + (owner || "(unassigned)"), body.by || "deck");
        return json({ ok: true, signupRow: row, taskRow: found, created: false });
      }

      var width = Math.max(tasks.getLastColumn(), 1);
      var out = new Array(width).fill("");
      Object.keys(task).forEach(function (k) {
        var header = WRITABLE[String(k).trim().toLowerCase()];
        if (!header) return;
        var col = tmap[header.toLowerCase()];
        if (col && col <= width) out[col - 1] = safeSheetValue_(task[k]);
      });
      tasks.appendRow(out);
      var newRow = tasks.getLastRow();
      logHistory(workSS, "create", String(task["Task"] || ""), "created by contributor assignment", body.by || "deck");
      return json({ ok: true, signupRow: row, taskRow: newRow, created: true });
    }

    return fail("unknown contributor op: " + body.op);
  } catch (err) {
    return fail(err && err.message ? err.message : err);
  } finally {
    lock.releaseLock();
  }
}

/* ── handlers ────────────────────────────────────────────────────────── */
function doGet(e) {
  return json({ ok: true, service: "bread-work-tracker", hint: "POST JSON with a token (work tracker + contributors)" });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return fail("body is not JSON");
  }
  if (!TOKEN || body.token !== TOKEN) return fail("bad token");

  if (String(body.op || "").indexOf("contributor.") === 0) {
    return handleContributor_(body);
  }

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
        sh.getRange(row, col).setValue(safeSheetValue_(patch[k]));
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
        if (col <= width) out[col - 1] = safeSheetValue_(fields[k]);
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
