/**
 * CRM consolidation: staging-copy-only migration and validation.
 * Paste into an Apps Script project that can edit a COPY of the CRM sheet.
 * Run breadCrmPreviewCopy(copyId), then breadCrmMigrateCopy(copyId), then
 * breadCrmValidateCopy(copyId). Never pass the production or feed sheet ID.
 * No function in this file writes to the feed, production CRM or old tabs.
 */
var CrmMigration = (function () {
  var LIVE_ID = "1c4PgSHC2N2n7VsFHhYH0PMvtQljvZg-ZQo6MtOojVYY";
  var FEED_ID = "19Lxe0C14BOYbOj0Z0nyoQc4-I_aw_jgybcq9LggfcUw";
  var CAMPAIGNS = [
    ["Stacks", "stacks"],
    ["SSE/IRL", "sse-irl"],
    ["Artizen", "artizen"],
    ["Devconnect 2025", "devconnect-2025"],
    ["Critical Technologist Collective?", "critical-technologist-collective"],
    ["Neo bank", "neo-bank"],
    ["Safety net", "safety-net"],
    ["Berlin Blockchain Week 2026", "berlin-blockchain-week-2026"],
    ["Client work", "client-work"],
    ["Solidarity Fund", "solidarity-fund"]
  ];
  var CAMPAIGN_HEADERS = ["CampaignID", "Campaign", "Status", "Owner", "Description", "Goal", "Created", "Archived", "Sort"];
  var CONTACT_HEADERS = ["ContactID", "CampaignID", "Campaign", "Contact", "Org", "Priority", "Status", "Goal", "Type", "Owner", "Action", "Project", "Deliverable", "LastConnectedRaw", "LastConnectedDate", "LocationMet", "Method", "CreatedAt", "UpdatedAt", "LegacyCampaign", "LegacyRow", "LegacyGID", "Notes"];
  var MAP_HEADERS = ["LegacyCampaign", "LegacyRow", "LegacyGID", "ContactID", "NewRow", "Flag", "TargetHash"];
  // Only these columns are replaced on a source-delta rerun. Org and timestamps
  // remain independent; a manual edit to ANY managed field is a conflict.
  var MANAGED = [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 20, 21, 22, 23];
  var SOURCE = {
    "Contact / Team": 4, "Priority": 6, "Status": 7, "Goal": 8,
    "Type": 9, "Owner": 10, "Action Steps": 11, "Project": 12,
    "Deliverable": 13, "Last Time Connected": 14, "Location Met": 16,
    "Communication Method Used": 17
  };

  function assertCopy(id) {
    id = String(id || "").trim();
    if (!id || id === LIVE_ID || id === FEED_ID) throw new Error("Pass the ID of an editable CRM COPY; production and feed IDs are forbidden");
    var ss = SpreadsheetApp.openById(id);
    if (ss.getId() !== id) throw new Error("Spreadsheet ID mismatch");
    return ss;
  }
  function digest(text) {
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
      .map(function (b) { return (b & 255).toString(16).slice(-2).padStart(2, "0"); }).join("");
  }
  function key(campaign, row) { return campaign + "|" + row; }
  function norm(value) { return String(value == null ? "" : value).trim().toLowerCase().replace(/\s+/g, " "); }
  function read(sh) {
    if (!sh || sh.getLastRow() === 0) return [];
    return sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  }
  function headerPosition(row) {
    var out = {};
    row.forEach(function (value, index) {
      var name = norm(value);
      if (name) {
        if (out[name] !== undefined) throw new Error("Duplicate source header: " + value);
        out[name] = index;
      }
    });
    return out;
  }
  function requireHeaders(sh, headers) {
    var rows = read(sh);
    if (!rows.length || headers.some(function (h, i) { return rows[0][i] !== h; }) || rows[0].length !== headers.length) {
      throw new Error(sh.getName() + " has unexpected headers; refusing to overwrite");
    }
    return rows.slice(1);
  }
  function scanSource(ss) {
    var records = [], counts = {}, nonempty = 0;
    CAMPAIGNS.forEach(function (pair) {
      var name = pair[0], sh = ss.getSheetByName(name);
      if (!sh) throw new Error("Missing legacy tab: " + name);
      var rows = read(sh), h = null, first = -1;
      for (var i = 0; i < Math.min(rows.length, 20); i++) {
        if (rows[i].some(function (v) { return norm(v) === "contact / team"; })) {
          h = headerPosition(rows[i]); first = i; break;
        }
      }
      if (first < 0) throw new Error("No Contact / Team header in " + name);
      var required = ["contact / team", "priority", "status", "owner", "action steps", "project", "last time connected", "location met", "communication method used"];
      required.push(name === "Artizen" ? "type" : "goal");
      if (name !== "Artizen") required.push("deliverable");
      required.forEach(function (head) { if (h[head] === undefined) throw new Error("Missing " + head + " in " + name); });
      if (name === "Artizen" && h["goal"] !== undefined) throw new Error("Artizen schema changed; review mapping");
      counts[name] = 0;
      for (var r = first + 1; r < rows.length; r++) {
        var cells = rows[r], contact = cells[h["contact / team"]];
        if (!norm(contact) || norm(contact) === "contact / team") continue;
        var fields = {};
        Object.keys(SOURCE).forEach(function (head) {
          var col = h[norm(head)];
          fields[head] = col === undefined ? "" : (cells[col] || "");
        });
        records.push({ campaign: name, campaignId: pair[1], row: r + 1,
          gid: sh.getSheetId(), fields: fields });
        counts[name]++;
        if (fields["Last Time Connected"]) nonempty++;
      }
    });
    return { records: records, counts: counts, datesRaw: nonempty };
  }
  function dateValue(raw) {
    var text = String(raw || "").trim();
    if (!text) return "";
    var m, year, month, day;
    var months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
      jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text))) {
      year = +m[1]; month = +m[2]; day = +m[3];
    } else if ((m = /^(\d{1,2})[\s/-]+(\d{1,2})[\s/-]+(\d{4})$/.exec(text))) {
      month = +m[1]; day = +m[2]; year = +m[3];
      if (month > 12) { month = +m[2]; day = +m[1]; }
    } else if ((m = /^(?:(\d{1,2})\s*)?([A-Za-z]{3,9})[\s,/-]*(\d{4})$/i.exec(text))) {
      day = +(m[1] || 1); month = months[m[2].slice(0, 3).toLowerCase()]; year = +m[3];
    } else return "";
    var d = new Date(Date.UTC(year, month - 1, day));
    if (!month || year < 1900 || d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) return "";
    return year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  }
  function safe(text) {
    // setValues interprets a leading = as a formula even on plain-text cells.
    text = String(text == null ? "" : text);
    return /^=/.test(text) ? "'" + text : text;
  }
  function managedHash(row) {
    return digest(JSON.stringify(MANAGED.map(function (col) {
      var value = String(row[col - 1] == null ? "" : row[col - 1]);
      // setValues("'=...") is displayed by Sheets as "=...".
      return value.indexOf("'=") === 0 ? value.slice(1) : value;
    })));
  }
  function plannedRow(src, id, created, updated) {
    var f = src.fields, raw = f["Last Time Connected"], parsed = dateValue(raw);
    var row = [id, src.campaignId, src.campaign, f["Contact / Team"], "", f.Priority,
      f.Status, f.Goal, f.Type, f.Owner, f["Action Steps"], f.Project,
      f.Deliverable, raw, parsed, f["Location Met"], f["Communication Method Used"],
      created, updated, src.campaign, src.row, src.gid,
      raw && !parsed ? "unparsed date" : ""];
    return row.map(function (v, i) { return i === 20 || i === 21 ? v : safe(v); });
  }
  function prepare(ss) {
    var source = scanSource(ss), contactSheet = ss.getSheetByName("Contacts");
    var mapSheet = ss.getSheetByName("_migration_map"), campaignSheet = ss.getSheetByName("Campaigns");
    var existing = contactSheet ? requireHeaders(contactSheet, CONTACT_HEADERS) : [];
    var mappings = mapSheet ? requireHeaders(mapSheet, MAP_HEADERS) : [];
    var campaigns = campaignSheet ? requireHeaders(campaignSheet, CAMPAIGN_HEADERS) : [];
    if (existing.length && !mapSheet) throw new Error("Contacts has rows but no migration map");
    if (mappings.length && !contactSheet) throw new Error("Migration map has rows but Contacts tab is missing");
    var byKey = {}, usedIds = {}, usedRows = {};
    existing.forEach(function (row) {
      if (!row[0] || usedIds[row[0]]) throw new Error("Duplicate or empty ContactID in target");
      usedIds[row[0]] = true;
    });
    mappings.forEach(function (row) {
      var k = key(row[0], row[1]), newRow = +row[4], actual = existing[newRow - 2];
      if (byKey[k] || usedRows[newRow] || !actual || actual[0] !== row[3] ||
          actual[19] !== row[0] || +actual[20] !== +row[1] ||
          actual[21] != row[2] || managedHash(actual) !== row[6]) {
        throw new Error("Conflicting migration map or edited Contacts row for " + k);
      }
      byKey[k] = { map: row, current: actual, newRow: newRow };
      usedRows[newRow] = true;
    });
    if (existing.length && mappings.length !== existing.length) {
      throw new Error("Unmapped Contacts rows: do not rerun migration on an edited target");
    }
    if (campaigns.length) {
      if (campaigns.length !== CAMPAIGNS.length || CAMPAIGNS.some(function (p, i) {
        return campaigns[i][0] !== p[1] || campaigns[i][1] !== p[0];
      })) throw new Error("Campaigns registry differs from seed; review manually");
    }
    return { source: source, existing: existing, mappings: mappings,
      campaigns: campaigns, byKey: byKey, usedIds: usedIds };
  }
  function create(ss, name, headers) {
    var sh = ss.getSheetByName(name);
    if (sh) { requireHeaders(sh, headers); return sh; }
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    return sh;
  }
  function batch(sh, start, rows, width) {
    for (var i = 0; i < rows.length; i += 500) {
      var range = sh.getRange(start + i, 1, Math.min(500, rows.length - i), width);
      range.setNumberFormat("@"); // ISO dates and IDs must remain text in every locale
      range.setValues(rows.slice(i, i + 500));
    }
  }
  function installValidation(contacts, campaigns) {
    var n = contacts.getMaxRows() - 1;
    if (!n) return;
    contacts.getRange(2, 2, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInRange(campaigns.getRange(2, 1, campaigns.getMaxRows() - 1, 1), true)
      .setAllowInvalid(false).build());
    contacts.getRange(2, 6, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(["Immediate", "High", "Low"], true).setAllowInvalid(false).build());
    contacts.getRange(2, 7, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(["Contacted", "Not contacted", "Blocked", "Completed", "Declined"], true)
      .setAllowInvalid(false).build());
  }
  function productionBook() {
    var p = PropertiesService.getScriptProperties();
    if (p.getProperty("BREAD_ENVIRONMENT") !== "production" || p.getProperty("CRM_CUTOVER_APPROVED") !== "true" || p.getProperty("CRM_WRITE_FREEZE_CONFIRMED") !== "true" || p.getProperty("CRM_SPREADSHEET_ID") !== LIVE_ID) throw new Error("Production migration requires explicit cutover approval and confirmed write freeze");
    var backupId = p.getProperty("CRM_SOURCE_BACKUP_ID");
    if (!backupId || backupId === LIVE_ID || backupId === FEED_ID) throw new Error("Separate CRM source backup required");
    var ss = SpreadsheetApp.openById(LIVE_ID), backup = SpreadsheetApp.openById(backupId);
    if (JSON.stringify(scanSource(ss).records) !== JSON.stringify(scanSource(backup).records)) throw new Error("Production/source-backup content differs; take a fresh backup during the write freeze");
    return ss;
  }
  function migrate(copyId, production) {
    var ss = production ? productionBook() : assertCopy(copyId), lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) throw new Error("Migration is already running");
    try {
      var p = prepare(ss); // all source and target checks before any mutation
      var sourceKeys = {};
      p.source.records.forEach(function (record) { sourceKeys[key(record.campaign, record.row)] = true; });
      Object.keys(p.byKey).forEach(function (k) {
        if (!sourceKeys[k]) throw new Error("Mapped legacy row disappeared: " + k + "; reconcile manually");
      });
      var now = new Date().toISOString(), toAdd = [], toMap = [], toUpdate = [];
      p.source.records.forEach(function (src) {
        var k = key(src.campaign, src.row), old = p.byKey[k];
        var id;
        if (old) {
          if (norm(old.current[3]) !== norm(src.fields["Contact / Team"])) {
            throw new Error("Legacy row now names a different contact: " + k + "; reconcile shifted rows manually");
          }
          id = old.map[3];
        }
        else {
          var base = "c_" + digest(src.campaignId + "|" + src.row + "|" + src.fields["Contact / Team"]).slice(0, 10);
          id = base;
          for (var n = 2; p.usedIds[id]; n++) id = base + "-" + n;
          p.usedIds[id] = true;
        }
        var row = plannedRow(src, id, old ? old.current[17] : now, now);
        if (old) {
          row[4] = old.current[4]; // optional Org is not owned by this import
          // No write on an unchanged rerun, including UpdatedAt.
          if (managedHash(row) !== old.map[6]) toUpdate.push({ row: old.newRow, mapRow: p.mappings.indexOf(old.map) + 2, values: row });
        } else {
          var newRow = p.existing.length + toAdd.length + 2;
          toAdd.push(row);
          toMap.push([src.campaign, src.row, src.gid, id, newRow, row[22], managedHash(row)]);
        }
      });
      var contacts = create(ss, "Contacts", CONTACT_HEADERS);
      var map = create(ss, "_migration_map", MAP_HEADERS);
      var campaigns = create(ss, "Campaigns", CAMPAIGN_HEADERS);
      if (!p.campaigns.length) {
        batch(campaigns, 2, CAMPAIGNS.map(function (c, i) {
          return [c[1], c[0], "Active", "", "", "", "", "", i + 1];
        }), CAMPAIGN_HEADERS.length);
      }
      installValidation(contacts, campaigns);
      // Map is written after Contacts; a failed partial write requires manual
      // reconciliation, never automatic erasure of the partially written data.
      batch(contacts, p.existing.length + 2, toAdd, CONTACT_HEADERS.length);
      toUpdate.forEach(function (item) {
        var range = contacts.getRange(item.row, 1, 1, CONTACT_HEADERS.length);
        range.setNumberFormat("@");
        range.setValues([item.values]);
        map.getRange(item.mapRow, 7).setValue(managedHash(item.values));
      });
      batch(map, p.mappings.length + 2, toMap, MAP_HEADERS.length);
      var report = validate(ss);
      if (!report.ok) throw new Error("Post-migration validation failed: " + report.errors.join("; "));
      return { added: toAdd.length, updated: toUpdate.length, total: report.total,
        counts: report.counts, unparsedDates: report.unparsedDates };
    } finally { lock.releaseLock(); }
  }
  function validate(ss) {
    var errors = [], p;
    try { p = prepare(ss); } catch (e) { return { ok: false, errors: [String(e.message || e)] }; }
    var counts = {}, unparsed = [], byKey = p.byKey;
    var sourceStatuses = {}, targetStatuses = {}, sourcePriorities = {}, targetPriorities = {};
    function tally(bucket, value) { value = value || "(blank)"; bucket[value] = (bucket[value] || 0) + 1; }
    p.source.records.forEach(function (src) {
      var k = key(src.campaign, src.row), entry = byKey[k];
      if (!entry) { errors.push("Missing " + k); return; }
      var row = entry.current;
      counts[src.campaign] = (counts[src.campaign] || 0) + 1;
      tally(sourceStatuses, src.fields.Status); tally(targetStatuses, row[6]);
      tally(sourcePriorities, src.fields.Priority); tally(targetPriorities, row[5]);
      if (row[3] !== src.fields["Contact / Team"]) errors.push("Contact mismatch: " + k);
      if (row[13] && !row[14] && row[22] !== "unparsed date") errors.push("Unflagged date: " + k);
      if (row[22] === "unparsed date") unparsed.push(k);
      var expected = plannedRow(src, row[0], row[17], row[18]);
      if (managedHash(expected) !== entry.map[6]) errors.push("Source changed since migration: " + k);
    });
    if (p.mappings.length !== p.source.records.length) errors.push("Map/source counts differ");
    CAMPAIGNS.forEach(function (c) {
      if ((counts[c[0]] || 0) !== p.source.counts[c[0]]) errors.push("Count mismatch: " + c[0]);
    });
    if (JSON.stringify(sourceStatuses) !== JSON.stringify(targetStatuses)) errors.push("Status distribution differs");
    if (JSON.stringify(sourcePriorities) !== JSON.stringify(targetPriorities)) errors.push("Priority distribution differs");
    if (p.campaigns.length !== CAMPAIGNS.length) errors.push("Campaign registry not seeded");
    return { ok: !errors.length, errors: errors, total: p.mappings.length,
      counts: counts, datesRaw: p.source.datesRaw, unparsedDates: unparsed,
      statuses: targetStatuses, priorities: targetPriorities };
  }
  function preview(copyId) {
    var p = prepare(assertCopy(copyId));
    return { sourceTotal: p.source.records.length, counts: p.source.counts,
      datesRaw: p.source.datesRaw, alreadyMapped: p.mappings.length,
      productionBaseline: 208, baselineMatches: p.source.records.length === 208 };
  }
  return { preview: preview, migrate: migrate,
    validate: function (id) { return validate(assertCopy(id)); },
    migrateProduction: function () { return migrate(null, true); },
    dateValue: dateValue, contactHeaders: CONTACT_HEADERS, mapHeaders: MAP_HEADERS };
}());

function breadCrmPreviewCopy(copyId) { return CrmMigration.preview(copyId); }
function breadCrmMigrateCopy(copyId) { return CrmMigration.migrate(copyId); }
function breadCrmValidateCopy(copyId) { return CrmMigration.validate(copyId); }

// Owner-only cutover entry point. Never expose through the web router.
function breadCrmMigrateProduction() { return CrmMigration.migrateProduction(); }
