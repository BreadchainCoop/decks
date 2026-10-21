/** Bread HQ module. Exposed by the consolidated suite web app, not a second doPost.
 * HQ_SPREADSHEET_ID: a separate, editable HQ spreadsheet (no default).
 * HQ_COMMITTEE_TOKEN: separate 32+ character secret for directive drafting.
 * Member authentication and script locking are provided by BreadSuite.
 */
var BreadHq = (function () {
  var SCHEMAS = {
    Resources: ["ResourceID", "Title", "URL", "Category", "Description", "Status", "CreatedAt", "UpdatedAt"],
    Directives: ["DirectiveID", "Title", "Body", "Owner", "Status", "Start", "End", "CreatedAt", "UpdatedAt"],
    TimeOff: ["TimeOffID", "Person", "Start", "End", "Note", "Status", "CreatedAt", "UpdatedAt"],
    History: ["Timestamp", "Op", "Ref", "Fields", "By"]
  };
  function str(v, max) {
    if (typeof v !== "string" || v.length > (max || 20000)) throw new Error("Invalid text field");
    return v;
  }
  function date(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    var d = new Date(v + "T00:00:00Z");
    return isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }
  function url(v) { return /^https?:\/\/[^\s<>"']+$/i.test(v); }
  function safe(v) { v = String(v); return v.charAt(0) === "=" ? "'" + v : v; }
  function table(ss, name, create) {
    var sh = ss.getSheetByName(name), headers = SCHEMAS[name];
    if (!sh && create) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.setFrozenRows(1);
    }
    if (!sh || sh.getLastColumn() !== headers.length) throw new Error("HQ setup/schema required: " + name);
    var head = sh.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
    if (head.some(function (h, i) { return h !== headers[i]; })) throw new Error("Unexpected HQ headers: " + name);
    var rows = sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).getDisplayValues();
    return { sh: sh, headers: headers, rows: rows };
  }
  function write(t, row, values) {
    var range = t.sh.getRange(row, 1, 1, t.headers.length);
    range.setNumberFormat("@");
    range.setValues([values.map(safe)]);
  }
  function objects(t) {
    return t.rows.filter(function (r) { return r[0]; }).map(function (r) {
      var o = {};
      t.headers.forEach(function (h, i) { o[h] = String(r[i] || ""); });
      return o;
    });
  }
  function find(t, id, expected) {
    str(id, 100);
    var matches = [];
    t.rows.forEach(function (r, i) { if (r[0] === id) matches.push({ row: i + 2, values: r }); });
    if (matches.length !== 1) throw new Error("HQ record missing or ambiguous; refresh");
    var item = matches[0];
    if (!expected || item.values[t.headers.indexOf("UpdatedAt")] !== expected) throw new Error("HQ record changed; refresh before saving");
    return item;
  }
  function validate(fields, allowed, required) {
    if (!fields || typeof fields !== "object" || Array.isArray(fields) || !Object.keys(fields).length) throw new Error("Fields required");
    Object.keys(fields).forEach(function (h) { if (allowed.indexOf(h) < 0) throw new Error("HQ field not writable: " + h); str(fields[h]); });
    (required || []).forEach(function (h) { if (!String(fields[h] || "").trim()) throw new Error(h + " required"); });
  }
  function handle(body, ss, committee) {
    var op = String(body.op || "");
    if (op === "hq.read") {
      return { ok: true,
        resources: objects(table(ss, "Resources", false)).filter(function (o) { return o.Status === "Active"; }),
        directives: objects(table(ss, "Directives", false)).filter(function (o) { return committee || o.Status === "Published"; }),
        timeOff: objects(table(ss, "TimeOff", false)), committee: !!committee,
        budget: typeof BreadBudget !== "undefined" ? BreadBudget.read() : null };
    }
    var type = op.split(".")[1], action = op.split(".")[2];
    var tabs = { resource: "Resources", directive: "Directives", timeoff: "TimeOff" };
    if (op.split(".").length !== 3 || !tabs[type] || ["add", "update", "archive"].indexOf(action) < 0) throw new Error("Unsupported HQ operation");
    if (type === "directive" && !committee) throw new Error("Committee authorization required");
    var t = table(ss, tabs[type], false), hist = table(ss, "History", false);
    var allowed = type === "resource" ? ["Title", "URL", "Category", "Description"] :
      type === "directive" ? ["Title", "Body", "Owner", "Status", "Start", "End"] : ["Person", "Start", "End", "Note"];
    var required = type === "resource" ? ["Title", "URL"] : type === "directive" ? ["Title", "Body"] : ["Person", "Start", "End"];
    var fields = body.fields, item, values, now = new Date().toISOString();
    if (action === "add") {
      validate(fields, allowed, required);
      values = t.headers.map(function () { return ""; });
      do { values[0] = type + "_" + Utilities.getUuid().replace(/-/g, "").slice(0, 16); }
      while (t.rows.some(function (r) { return r[0] === values[0]; }));
      values[t.headers.indexOf("CreatedAt")] = now;
      values[t.headers.indexOf("Status")] = type === "directive" ? "Draft" : "Active";
      item = { row: t.sh.getLastRow() + 1, values: values };
    } else {
      item = find(t, body.id, body.expectedUpdatedAt);
      values = item.values.slice();
      if (action === "archive") fields = { Status: type === "timeoff" ? "Cancelled" : "Archived" };
      else validate(fields, allowed, []);
    }
    Object.keys(fields).forEach(function (h) { values[t.headers.indexOf(h)] = fields[h]; });
    function val(h) { return values[t.headers.indexOf(h)]; }
    if (type === "resource" && (!val("Title").trim() || !url(val("URL")))) throw new Error("Resource needs a title and an http(s) URL");
    if (type === "directive") {
      if (!val("Title").trim() || !val("Body").trim() || ["Draft", "Published", "Archived"].indexOf(val("Status")) < 0) throw new Error("Invalid directive");
      if ((val("Start") && !date(val("Start"))) || (val("End") && !date(val("End"))) || (val("Start") && val("End") && val("End") < val("Start"))) throw new Error("Invalid directive dates");
    }
    if (type === "timeoff" && (!val("Person").trim() || !date(val("Start")) || !date(val("End")) || val("End") < val("Start"))) throw new Error("Time off needs a person and an inclusive, valid date range");
    var by = body.by === undefined ? "member" : str(body.by, 200);
    // Ensure a revision changes even for two writes within the same millisecond.
    var previous = values[t.headers.indexOf("UpdatedAt")];
    if (previous && now <= previous) now = new Date(new Date(previous).getTime() + 1).toISOString();
    values[t.headers.indexOf("UpdatedAt")] = now;
    write(t, item.row, values);
    write(hist, hist.sh.getLastRow() + 1, [now, op, values[0], Object.keys(fields).join(", "), by]);
    return { ok: true, id: values[0], updatedAt: now };
  }
  function setup() {
    var id = PropertiesService.getScriptProperties().getProperty("HQ_SPREADSHEET_ID");
    if (!id) throw new Error("Set HQ_SPREADSHEET_ID to a separate editable HQ sheet");
    if (typeof Bh !== "undefined") Bh.assertWriteDestination(id);
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) throw new Error("Busy");
    try {
      var ss = SpreadsheetApp.openById(id);
      // Preflight every existing tab before creating any missing ones.
      Object.keys(SCHEMAS).forEach(function (name) { if (ss.getSheetByName(name)) table(ss, name, false); });
      Object.keys(SCHEMAS).forEach(function (name) { table(ss, name, true); });
      var resources = table(ss, "Resources", false), seeded = 0, now = new Date().toISOString();
      var references = [
        ["reference_directives", "Strategic directives master document", "https://docs.google.com/document/d/1NsvX9b544yW8Bj8ZvozowrAqZ3dbgvClvy-9r9VT3dU/edit?tab=t.253tlm5pp47g", "Governance", "Authoritative master document; check approval status before treating drafts as adopted policy."],
        ["reference_budget", "Budget & runway calculator", "https://docs.google.com/spreadsheets/d/1iWZXv2yaquz_oRlYGCn0jhJYsVuseea6e0aE2EpYsx8/edit?gid=1139000984#gid=1139000984", "Finance", "Calculator scenario, not a verified current balance. The linked tab was labelled Q3 2026 (Aug-Oct) when inspected."]
      ];
      references.forEach(function (ref) {
        if (!resources.rows.some(function (r) { return r[0] === ref[0] || r[2] === ref[2]; })) {
          write(resources, resources.sh.getLastRow() + 1, ref.concat(["Active", now, now])); seeded++;
        }
      });
      return { ok: true, spreadsheetId: id, tabs: Object.keys(SCHEMAS), referencesAdded: seeded };
    } finally { lock.releaseLock(); }
  }
  return { handle: handle, setup: setup, validDate: date, validUrl: url };
}());

function breadHqSetup() { return BreadHq.setup(); }
