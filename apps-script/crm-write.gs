/** Standalone CRM write web app for the consolidated schema.
 * Install AFTER crm-migration.gs has populated an editable staging copy.
 * Script Properties: CRM_SPREADSHEET_ID=<copy ID>, CRM_WRITE_TOKEN=<random secret>.
 * Deploy as owner / Anyone; the token authorizes writes. Never commit it.
 * This is a separate project from work-tracker-write.gs (both define doPost).
 * No legacy operations: the old dashboard must NOT be pointed at this endpoint.
 */
var CrmWrite = (function () {
  var CONTACT_HEADERS = ["ContactID", "CampaignID", "Campaign", "Contact", "Org", "Priority", "Status", "Goal", "Type", "Owner", "Action", "Project", "Deliverable", "LastConnectedRaw", "LastConnectedDate", "LocationMet", "Method", "CreatedAt", "UpdatedAt", "LegacyCampaign", "LegacyRow", "LegacyGID", "Notes"];
  var CAMPAIGN_HEADERS = ["CampaignID", "Campaign", "Status", "Owner", "Description", "Goal", "Created", "Archived", "Sort"];
  var HISTORY_HEADERS = ["Timestamp", "Op", "Campaign", "Contact", "Detail", "By", "ContactID"];
  // Preserve the legacy column order. IDs are appended, never inserted.
  var LINK_HEADERS = ["Timestamp", "Type", "LeftCampaign", "LeftRow", "LeftContact", "RightCampaign", "RightRow", "RightContact", "Note", "By", "LeftContactID", "RightContactID"];
  var WRITABLE = ["Org", "Priority", "Status", "Goal", "Type", "Owner", "Action", "Project", "Deliverable", "LastConnectedRaw", "LastConnectedDate", "LocationMet", "Method", "Notes"];
  var PRIORITIES = ["", "Immediate", "High", "Low"];
  var STATUSES = ["", "Contacted", "Not contacted", "Blocked", "Completed", "Declined"];
  function text(value) {
    if (typeof value !== "string" || value.length > 20000) throw new Error("Fields must be strings of at most 20000 characters");
    return value;
  }
  function safe(value) { return value.charAt(0) === "=" ? "'" + value : value; }
  function object(value) { return value && typeof value === "object" && !Array.isArray(value); }
  function table(ss, name, headers, create) {
    var sh = ss.getSheetByName(name);
    if (!sh && create) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.setFrozenRows(1);
    }
    if (!sh) throw new Error("Missing " + name + "; run migration first");
    var width = sh.getLastColumn();
    if (width < headers.length) throw new Error("Upgrade " + name + " headers before enabling CRM writes");
    var head = sh.getRange(1, 1, 1, width).getDisplayValues()[0];
    if (head.length !== headers.length || head.some(function (h, i) { return h !== headers[i]; })) {
      throw new Error("Unexpected " + name + " schema");
    }
    return { sh: sh, headers: headers, rows: sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, width).getDisplayValues() };
  }
  function find(t, id) {
    id = text(id || "");
    if (!id) throw new Error("Stable ID required");
    var matches = [];
    t.rows.forEach(function (row, i) { if (row[0] === id) matches.push({ values: row, row: i + 2 }); });
    if (matches.length !== 1) throw new Error("ID not found or ambiguous; refresh");
    return matches[0];
  }
  function newId(t, prefix) {
    var id;
    do { id = prefix + Utilities.getUuid().replace(/-/g, "").slice(0, 16); }
    while (t.rows.some(function (r) { return r[0] === id; }));
    return id;
  }
  function validatePatch(patch, allowed) {
    if (!object(patch) || !Object.keys(patch).length) throw new Error("Non-empty fields/patch required");
    Object.keys(patch).forEach(function (field) {
      if (allowed.indexOf(field) < 0) throw new Error("Field is not writable: " + field);
      var value = text(patch[field]);
      if (field === "Status" && STATUSES.indexOf(value) < 0) throw new Error("Invalid contact Status");
      if (field === "Priority" && PRIORITIES.indexOf(value) < 0) throw new Error("Invalid Priority");
      if (field === "LastConnectedDate" && value && !validDate(value)) throw new Error("LastConnectedDate must be a real yyyy-mm-dd date");
    });
  }
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var d = new Date(value + "T00:00:00Z");
    return isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
  }
  function append(t, values) {
    var row = t.sh.getLastRow() + 1;
    write(t, row, values);
    return row;
  }
  function write(t, row, values) {
    var range = t.sh.getRange(row, 1, 1, t.headers.length);
    range.setNumberFormat("@");
    range.setValues([values.map(function (v) { return safe(String(v)); })]);
  }
  function history(t, op, contact, changed, by, now) {
    // Log field names only: do not copy coordinates or private notes to feedable History.
    append(t, [now, op, contact ? contact[2] : "", contact ? contact[3] : "",
      changed.join(", "), by, contact ? contact[0] : ""]);
  }
  function handle(body, ss) {
    if (!object(body)) throw new Error("JSON object required");
    var op = text(body.op || "");
    var allowedOps = ["contact.update", "contact.mark", "contact.add", "contact.link", "contact.unlink", "campaign.create", "campaign.archive", "campaign.restore"];
    if (allowedOps.indexOf(op) < 0) throw new Error("Unsupported operation; consolidated CRM client required");
    var by = body.by === undefined ? "dashboard" : text(body.by);
    var contacts = table(ss, "Contacts", CONTACT_HEADERS, false);
    var campaigns = table(ss, "Campaigns", CAMPAIGN_HEADERS, false);
    // Validate existing audit schemas before changing any contact/campaign.
    if (ss.getSheetByName("History")) table(ss, "History", HISTORY_HEADERS, false);
    if (ss.getSheetByName("Links")) table(ss, "Links", LINK_HEADERS, false);
    var now = new Date().toISOString(), audit, entry, patch, changed;
    if (op === "contact.update" || op === "contact.mark") {
      entry = find(contacts, body.contactId);
      patch = op === "contact.mark" ? { Status: "Contacted", LastConnectedRaw: now.slice(0, 10), LastConnectedDate: now.slice(0, 10) } : body.patch;
      validatePatch(patch, WRITABLE);
      changed = Object.keys(patch).filter(function (field) { return entry.values[CONTACT_HEADERS.indexOf(field)] !== patch[field]; });
      if (!changed.length) return { ok: true, contactId: entry.values[0], changed: [] };
      changed.forEach(function (field) { entry.values[CONTACT_HEADERS.indexOf(field)] = patch[field]; });
      entry.values[18] = now;
      audit = table(ss, "History", HISTORY_HEADERS, true);
      write(contacts, entry.row, entry.values);
      history(audit, op, entry.values, changed, by, now);
      return { ok: true, contactId: entry.values[0], changed: changed };
    }
    if (op === "contact.add") {
      patch = body.fields;
      validatePatch(patch, WRITABLE.concat(["Contact"]));
      if (!String(patch.Contact || "").trim()) throw new Error("Contact required");
      var campaign = find(campaigns, body.campaignId).values;
      if (campaign[2] !== "Active") throw new Error("Cannot add to an archived campaign");
      var values = CONTACT_HEADERS.map(function () { return ""; });
      values[0] = newId(contacts, "c_"); values[1] = campaign[0]; values[2] = campaign[1];
      Object.keys(patch).forEach(function (field) { values[CONTACT_HEADERS.indexOf(field)] = patch[field]; });
      values[17] = now; values[18] = now;
      audit = table(ss, "History", HISTORY_HEADERS, true);
      var row = append(contacts, values);
      history(audit, op, values, Object.keys(patch), by, now);
      return { ok: true, contactId: values[0], row: row, changed: Object.keys(patch) };
    }
    if (op === "campaign.create") {
      var name = text(body.name || "").trim();
      if (!name || name.length > 200) throw new Error("Campaign name required (max 200 characters)");
      if (campaigns.rows.some(function (r) { return r[1].trim().toLowerCase() === name.toLowerCase(); })) throw new Error("Campaign name already exists");
      var owner = text(body.owner || ""), description = text(body.description || ""), goal = text(body.goal || "");
      var base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      if (!base) base = newId(campaigns, "campaign-");
      var campaignId = base;
      for (var suffix = 2; campaigns.rows.some(function (r) { return r[0] === campaignId; }); suffix++) campaignId = base + "-" + suffix;
      audit = table(ss, "History", HISTORY_HEADERS, true);
      append(campaigns, [campaignId, name, "Active", owner, description, goal, now, "", campaigns.rows.length + 1]);
      history(audit, op, null, [campaignId], by, now);
      return { ok: true, campaignId: campaignId, changed: ["Campaign"] };
    }
    if (op === "campaign.archive" || op === "campaign.restore") {
      entry = find(campaigns, body.campaignId);
      var status = op === "campaign.archive" ? "Archived" : "Active";
      if (entry.values[2] === status) return { ok: true, campaignId: entry.values[0], changed: [] };
      entry.values[2] = status; entry.values[7] = status === "Archived" ? now : "";
      audit = table(ss, "History", HISTORY_HEADERS, true);
      write(campaigns, entry.row, entry.values);
      history(audit, op, null, [entry.values[0], "Status"], by, now);
      return { ok: true, campaignId: entry.values[0], changed: ["Status"] };
    }
    var left = find(contacts, body.leftId).values, right = find(contacts, body.rightId).values;
    if (left[0] === right[0]) throw new Error("Cannot link a contact to itself");
    var type = text(body.type || "").trim();
    if (!type) throw new Error("Link type required");
    var note = body.note === undefined ? "" : text(body.note);
    var links = table(ss, "Links", LINK_HEADERS, true);
    var matches = [];
    links.rows.forEach(function (r, i) {
      if (r[1] === type && ((r[10] === left[0] && r[11] === right[0]) || (r[10] === right[0] && r[11] === left[0]))) matches.push(i + 2);
    });
    if (op === "contact.link" && matches.length) return { ok: true, changed: [] };
    if (op === "contact.unlink" && !matches.length) return { ok: true, changed: [] };
    audit = table(ss, "History", HISTORY_HEADERS, true);
    if (op === "contact.link") append(links, [now, type, left[2], "", left[3], right[2], "", right[3], note, by, left[0], right[0]]);
    else matches.reverse().forEach(function (row) { links.sh.deleteRow(row); });
    history(audit, op, left, ["link", type, right[0]], by, now);
    return { ok: true, changed: ["Links"] };
  }
  function post(event) {
    var lock, acquired = false;
    try {
      var props = PropertiesService.getScriptProperties();
      var token = props.getProperty("CRM_WRITE_TOKEN"), id = props.getProperty("CRM_SPREADSHEET_ID");
      if (!token || token.length < 32 || !id) throw new Error("CRM endpoint is not configured");
      var raw = event && event.postData && event.postData.contents;
      if (!raw || raw.length > 100000) throw new Error("Missing or oversized JSON body");
      var body = JSON.parse(raw);
      if (!object(body) || typeof body.token !== "string" || body.token !== token) throw new Error("Unauthorized");
      lock = LockService.getScriptLock();
      acquired = lock.tryLock(10000);
      if (!acquired) throw new Error("Busy; try again");
      return handle(body, SpreadsheetApp.openById(id));
    } catch (e) {
      // Do not echo property values, payloads, or service errors to public callers.
      console.error("CRM write failed: " + (e && e.message ? e.message : "unknown error"));
      return { ok: false, error: "CRM write rejected; check configuration, IDs, fields and sheet schemas" };
    } finally { if (acquired) lock.releaseLock(); }
  }
  function prepareSchema(production) {
    var p = PropertiesService.getScriptProperties(), id = p.getProperty("CRM_SPREADSHEET_ID");
    if (production && (p.getProperty("BREAD_ENVIRONMENT") !== "production" || p.getProperty("CRM_CUTOVER_APPROVED") !== "true" || p.getProperty("CRM_WRITE_FREEZE_CONFIRMED") !== "true" || !p.getProperty("CRM_SOURCE_BACKUP_ID"))) throw new Error("Production schema preparation requires approved, backed-up write freeze");
    if (!id || (!production && id === "1c4PgSHC2N2n7VsFHhYH0PMvtQljvZg-ZQo6MtOojVYY") ||
        id === "19Lxe0C14BOYbOj0Z0nyoQc4-I_aw_jgybcq9LggfcUw") {
      throw new Error("Schema preparation is staging-copy-only");
    }
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) throw new Error("Busy; try again");
    try {
      var ss = SpreadsheetApp.openById(id);
      table(ss, "Contacts", CONTACT_HEADERS, false);
      table(ss, "Campaigns", CAMPAIGN_HEADERS, false);
      var plans = [["History", HISTORY_HEADERS, 6], ["Links", LINK_HEADERS, 10]];
      plans.forEach(function (plan) {
        var sh = ss.getSheetByName(plan[0]);
        if (!sh) return;
        var width = sh.getLastColumn();
        if (width !== plan[2] && width !== plan[1].length) throw new Error("Unexpected " + plan[0] + " schema");
        var head = sh.getRange(1, 1, 1, width).getDisplayValues()[0];
        if (head.some(function (h, i) { return h !== plan[1][i]; })) throw new Error("Unexpected " + plan[0] + " headers");
      });
      plans.forEach(function (plan) {
        var sh = ss.getSheetByName(plan[0]);
        if (!sh) { table(ss, plan[0], plan[1], true); return; }
        if (sh.getLastColumn() === plan[2]) {
          var extra = plan[1].slice(plan[2]);
          sh.getRange(1, plan[2] + 1, 1, extra.length).setValues([extra]);
        }
      });
      var contacts = table(ss, "Contacts", CONTACT_HEADERS, false), names = Object.create(null), locations = Object.create(null);
      contacts.rows.forEach(function (r) {
        var nameKey = JSON.stringify([r[19] || r[2], String(r[3]).trim().toLowerCase()]);
        (names[nameKey] = names[nameKey] || []).push(r[0]);
        if (r[19] && r[20]) {
          var rowKey = JSON.stringify([r[19], String(r[20])]);
          (locations[rowKey] = locations[rowKey] || []).push({ id: r[0], name: String(r[3]).trim().toLowerCase() });
        }
      });
      var history = table(ss, "History", HISTORY_HEADERS, false), historyBackfilled = 0, unresolvedHistory = 0, linksBackfilled = 0;
      history.rows.forEach(function (r, i) {
        if (r[6]) return;
        var candidates = names[JSON.stringify([r[2], String(r[3]).trim().toLowerCase()])] || [];
        if (candidates.length === 1) { history.sh.getRange(i + 2, 7).setValue(candidates[0]); historyBackfilled++; }
        else if (r[3]) unresolvedHistory++;
      });
      var links = table(ss, "Links", LINK_HEADERS, false);
      links.rows.forEach(function (r, i) {
        [[2, 3, 4, 10], [5, 6, 7, 11]].forEach(function (side) {
          if (r[side[3]]) return;
          var candidates = locations[JSON.stringify([r[side[0]], String(r[side[1]])])] || [];
          if (candidates.length === 1 && (!r[side[2]] || candidates[0].name === String(r[side[2]]).trim().toLowerCase())) {
            links.sh.getRange(i + 2, side[3] + 1).setValue(candidates[0].id); linksBackfilled++;
          }
        });
      });
      return { ok: true, historyBackfilled: historyBackfilled, unresolvedHistory: unresolvedHistory, linkSidesBackfilled: linksBackfilled,
        note: "Legacy rows retained; only unique, verified identities were backfilled" };
    } finally { lock.releaseLock(); }
  }
  return { post: post, prepareSchema: prepareSchema, handle: handle };
}());

// Run manually as project owner on the staging copy, not via HTTP.
function breadCrmPrepareWriteSchemaCopy() { return CrmWrite.prepareSchema(); }
function breadCrmPrepareWriteSchemaProduction() { return CrmWrite.prepareSchema(true); }

function doPost(event) {
  var result = CrmWrite.post(event);
  // CrmWrite.post releases its lock before this projection takes the same lock.
  // Projection failure must not turn a successful write into an apparent
  // rejection (which could cause a duplicate add on retry).
  if (result.ok && typeof CrmFeed !== "undefined" &&
      PropertiesService.getScriptProperties().getProperty("CRM_FEED_ID")) {
    try { CrmFeed.refresh(); result.feedUpdated = true; }
    catch (e) { result.feedUpdated = false; console.error("CRM feed projection needs attention"); }
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}
