/** Single suite router. Built with build-suite.cjs; do not paste alongside
 * unrenamed standalone doPost functions. Configuration lives in Properties.
 * BREAD_WRITE_TOKEN (32+ chars), WORK_SPREADSHEET_ID, CONTRIB_SPREADSHEET_ID,
 * CRM_SPREADSHEET_ID, HQ_SPREADSHEET_ID, GRANTS_SPREADSHEET_ID.
 */
var BreadSuite = (function () {
  function property(name) { return PropertiesService.getScriptProperties().getProperty(name) || ""; }
  function result(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
  function configuredBook(key) {
    var id = property(key);
    if (!id) throw new Error("Sheet not configured");
    return SpreadsheetApp.openById(Bh.assertWriteDestination(id));
  }
  function dispatch(body, event) {
    var op = String(body.op || ""), lock, response;
    if (op.indexOf("contributor.") === 0) {
      Bh.assertWriteDestination(property("CONTRIB_SPREADSHEET_ID")); Bh.assertWriteDestination(property("WORK_SPREADSHEET_ID"));
      if (typeof body.name !== "string" || !body.name.trim() || !isFinite(Number(body.timestampMs)) || Number(body.timestampMs) <= 0) throw new Error("Signup name and timestamp required");
      return handleContributor_(body); // module owns its lock
    }
    if (["work.update", "work.add", "update", "add"].indexOf(op) >= 0) {
      if (!property("WORK_SPREADSHEET_ID")) throw new Error("Work sheet not configured");
      Bh.assertWriteDestination(property("WORK_SPREADSHEET_ID"));
      if (body.campaign !== undefined || body.contact !== undefined) throw new Error("Legacy CRM packets must not target the suite endpoint");
      if ((op === "work.update" || op === "update") && (typeof body.task !== "string" || !body.task.trim())) throw new Error("Task title required to verify row hint");
      body.op = op.replace(/^work\./, "");
      lock = LockService.getScriptLock();
      if (!lock.tryLock(10000)) throw new Error("Busy");
      try { return breadLegacyWorkPost_({ postData: { contents: JSON.stringify(body) } }); }
      finally { lock.releaseLock(); }
    }
    if (op.indexOf("crm.") === 0) op = body.op = "contact." + op.slice(4);
    if (op.indexOf("contact.") === 0 || op.indexOf("campaign.") === 0) {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(10000)) throw new Error("Busy");
      try { response = CrmWrite.handle(body, configuredBook("CRM_SPREADSHEET_ID")); }
      finally { lock.releaseLock(); }
      if (property("CRM_FEED_ID")) {
        try { CrmFeed.refresh(); response.feedUpdated = true; }
        catch (e) { response.feedUpdated = false; }
      }
      return result(response);
    }
    if (op.indexOf("hq.") === 0) {
      var secret = property("HQ_COMMITTEE_TOKEN");
      var committee = secret.length >= 32 && secret !== property("BREAD_WRITE_TOKEN") && typeof body.committeeToken === "string" && body.committeeToken === secret;
      if (body.committeeToken && !committee) throw new Error("Committee authorization rejected");
      lock = LockService.getScriptLock();
      if (!lock.tryLock(10000)) throw new Error("Busy");
      try { response = BreadHq.handle(body, configuredBook("HQ_SPREADSHEET_ID"), committee); }
      finally { lock.releaseLock(); }
      return result(response);
    }
    if (op === "grants.update" || op === "grants.stage") {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(10000)) throw new Error("Busy");
      try { response = BreadGrants.handle(body, configuredBook("GRANTS_SPREADSHEET_ID")); }
      finally { lock.releaseLock(); }
      if (property("GRANTS_FEED_ID")) {
        try { var projected = BreadGrantsFeed.refresh(); response.feedUpdated = !!(projected && projected.ok); }
        catch (e) { response.feedUpdated = false; }
      }
      return result(response);
    }
    throw new Error("Unsupported suite operation");
  }
  function post(event) {
    try {
      var token = property("BREAD_WRITE_TOKEN");
      if (token.length < 32) throw new Error("Suite token not configured");
      var raw = event && event.postData && event.postData.contents;
      if (!raw || raw.length > 100000) throw new Error("Missing/oversized body");
      var body = JSON.parse(raw);
      if (!body || typeof body !== "object" || Array.isArray(body) || body.token !== token) throw new Error("Unauthorized");
      ["patch", "fields", "task"].forEach(function (key) {
        if (key === "task" && String(body.op || "").indexOf("contributor.") !== 0) return;
        if (body[key] === undefined) return;
        if (!body[key] || typeof body[key] !== "object" || Array.isArray(body[key]) || Object.keys(body[key]).length > 50) throw new Error("Invalid field object");
        Object.keys(body[key]).forEach(function (field) {
          var value = body[key][field];
          if (value !== null && ["string", "number", "boolean"].indexOf(typeof value) < 0) throw new Error("Invalid field value");
        });
      });
      if (String(body.op || "").indexOf("contributor.") === 0 && (!property("CONTRIB_SPREADSHEET_ID") || !property("WORK_SPREADSHEET_ID"))) throw new Error("Contributor sheets not configured");
      return dispatch(body, event);
    } catch (e) {
      console.error("Suite request rejected: " + (e && e.message ? e.message : "unknown"));
      return result({ ok: false, error: "Request rejected. Check authorization, IDs, fields, revisions and sheet configuration." });
    }
  }
  return { post: post };
}());

function doPost(event) { return BreadSuite.post(event); }
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: "bread-suite", version: 1, hint: "Authenticated POST required" }))
    .setMimeType(ContentService.MimeType.JSON);
}
