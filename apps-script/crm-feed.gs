/** Explicit, staging-only projection. Install with crm-write.gs in its project.
 * Script Properties: CRM_SPREADSHEET_ID=<CRM copy>, CRM_FEED_ID=<feed copy>.
 * Run breadCrmRefreshFeedCopy() manually after staging writes (or on a staging
 * timer). No production IDs, no inferred destination and no automatic deploy.
 */
var CrmFeed = (function () {
  var CONTACT_HEADERS = ["Campaign", "Contact", "Priority", "Goal", "Owner", "Status", "Action", "Project", "Deliverable", "LastConnected", "LocationMet", "Row", "GID", "ContactID", "CampaignID", "Type"];
  var CAMPAIGN_HEADERS = ["CampaignID", "Campaign", "Status", "Owner", "Description", "Goal", "Created", "Archived", "Sort"];
  var LINK_HEADERS = ["Timestamp", "Type", "LeftCampaign", "LeftRow", "LeftContact", "RightCampaign", "RightRow", "RightContact", "Note", "By", "LeftContactID", "RightContactID"];
  var HISTORY_HEADERS = ["Timestamp", "Op", "Campaign", "Contact", "Detail", "By", "ContactID"];
  function read(ss, name, required) {
    var sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 1) throw new Error("Missing source tab: " + name);
    var values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
    var headers = values.shift(), map = {};
    headers.forEach(function (h, i) {
      if (!h || Object.prototype.hasOwnProperty.call(map, h)) throw new Error("Invalid headers in " + name);
      map[h] = i;
    });
    required.forEach(function (h) { if (map[h] === undefined) throw new Error("Missing " + name + "." + h); });
    var rows = [], positions = [];
    values.forEach(function (r, i) { if (r.some(function (v) { return v !== ""; })) { rows.push(r); positions.push(i + 2); } });
    return { sh: sh, rows: rows, positions: positions, map: map };
  }
  function get(table, row, field) { return String(row[table.map[field]] || ""); }
  function safe(value) { value = String(value); return value.charAt(0) === "=" ? "'" + value : value; }
  function refresh() {
    var p = PropertiesService.getScriptProperties();
    var sourceId = p.getProperty("CRM_SPREADSHEET_ID"), feedId = p.getProperty("CRM_FEED_ID");
    var forbidden = ["1c4PgSHC2N2n7VsFHhYH0PMvtQljvZg-ZQo6MtOojVYY", "19Lxe0C14BOYbOj0Z0nyoQc4-I_aw_jgybcq9LggfcUw"];
    var production = p.getProperty("BREAD_ENVIRONMENT") === "production" && p.getProperty("CRM_CUTOVER_APPROVED") === "true";
    if (!sourceId || !feedId || sourceId === feedId || (!production && (forbidden.indexOf(sourceId) >= 0 || forbidden.indexOf(feedId) >= 0))) {
      throw new Error("Configure distinct staging CRM and feed COPY IDs; production IDs are forbidden");
    }
    if (production) {
      var backup = p.getProperty("CRM_FEED_BACKUP_ID");
      if (!backup || backup === sourceId || backup === feedId) throw new Error("Production feed backup is required");
      SpreadsheetApp.openById(backup).getSheets(); // fail before writes if backup is inaccessible
    }
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) throw new Error("CRM busy; try again");
    try {
      var source = SpreadsheetApp.openById(sourceId), feed = SpreadsheetApp.openById(feedId);
      var contacts = read(source, "Contacts", ["ContactID", "CampaignID", "Contact", "Priority", "Goal", "Owner", "Status", "Action", "Project", "Deliverable", "LastConnectedRaw", "LastConnectedDate", "LocationMet", "Type"]);
      var campaigns = read(source, "Campaigns", CAMPAIGN_HEADERS);
      var links = read(source, "Links", LINK_HEADERS), history = read(source, "History", HISTORY_HEADERS);
      var registry = Object.create(null), ids = Object.create(null);
      campaigns.rows.forEach(function (r) {
        var id = get(campaigns, r, "CampaignID"), name = get(campaigns, r, "Campaign"), status = get(campaigns, r, "Status");
        if (!id || registry[id] || !name || ["Active", "Archived"].indexOf(status) < 0) throw new Error("Invalid campaign registry");
        registry[id] = name;
      });
      var projected = contacts.rows.map(function (r, index) {
        var id = get(contacts, r, "ContactID"), campaignId = get(contacts, r, "CampaignID");
        if (!id || ids[id] || !registry[campaignId] || !get(contacts, r, "Contact").trim()) throw new Error("Invalid contact identity or campaign reference");
        ids[id] = true;
        return [registry[campaignId], get(contacts, r, "Contact"), get(contacts, r, "Priority"), get(contacts, r, "Goal"),
          get(contacts, r, "Owner"), get(contacts, r, "Status"), get(contacts, r, "Action"), get(contacts, r, "Project"),
          get(contacts, r, "Deliverable"), get(contacts, r, "LastConnectedDate") || get(contacts, r, "LastConnectedRaw"),
          get(contacts, r, "LocationMet"), String(contacts.positions[index]), String(contacts.sh.getSheetId()), id, campaignId, get(contacts, r, "Type")];
      });
      function projection(t, headers) { return t.rows.map(function (r) { return headers.map(function (h) { return get(t, r, h); }); }); }
      var plans = [
        { name: "Contacts", headers: CONTACT_HEADERS, rows: projected },
        { name: "Campaigns", headers: CAMPAIGN_HEADERS, rows: projection(campaigns, CAMPAIGN_HEADERS) },
        { name: "Links", headers: LINK_HEADERS, rows: projection(links, LINK_HEADERS) },
        { name: "History", headers: HISTORY_HEADERS, rows: projection(history, HISTORY_HEADERS) }
      ];
      // Never export Method, Org, Notes or arbitrary appended source columns.
      // Validate all source data before writing any destination tab. This is a
      // multi-tab Sheets write, NOT a transaction: rerun after service failure.
      var result = {};
      plans.forEach(function (plan) {
        var sh = feed.getSheetByName(plan.name) || feed.insertSheet(plan.name);
        var oldRows = sh.getLastRow(), oldCols = sh.getLastColumn();
        var values = [plan.headers].concat(plan.rows);
        if (sh.getMaxRows() < values.length) sh.insertRowsAfter(sh.getMaxRows(), values.length - sh.getMaxRows());
        if (sh.getMaxColumns() < plan.headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), plan.headers.length - sh.getMaxColumns());
        var range = sh.getRange(1, 1, values.length, plan.headers.length);
        range.setNumberFormat("@");
        range.setValues(values.map(function (r) { return r.map(safe); }));
        if (oldRows > values.length) sh.getRange(values.length + 1, 1, oldRows - values.length, Math.max(oldCols, plan.headers.length)).clearContent();
        if (oldCols > plan.headers.length) sh.getRange(1, plan.headers.length + 1, Math.max(oldRows, values.length), oldCols - plan.headers.length).clearContent();
        sh.setFrozenRows(1);
        result[plan.name] = { gid: sh.getSheetId(), rows: plan.rows.length };
      });
      return { ok: true, sourceId: sourceId, feedId: feedId, tabs: result };
    } finally { lock.releaseLock(); }
  }
  return { refresh: refresh };
}());

function breadCrmRefreshFeedCopy() {
  if (PropertiesService.getScriptProperties().getProperty("BREAD_ENVIRONMENT") === "production") throw new Error("Copy helper refuses production mode; use the reviewed production entry point");
  return CrmFeed.refresh();
}
function breadCrmRefreshFeedProduction() {
  var p = PropertiesService.getScriptProperties();
  if (p.getProperty("BREAD_ENVIRONMENT") !== "production" || p.getProperty("CRM_CUTOVER_APPROVED") !== "true") throw new Error("Production cutover approval required");
  return CrmFeed.refresh();
}
