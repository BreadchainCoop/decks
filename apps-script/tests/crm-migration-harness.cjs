#!/usr/bin/env node
/* Copy-only CRM migration test. Synthetic contacts only; no Google credentials. */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class Sheet {
  constructor(name, gid, values) { this.name = name; this.gid = gid; this.values = values; }
  getName() { return this.name; }
  getSheetId() { return this.gid; }
  getLastRow() { return this.values.length; }
  getLastColumn() { return this.values.reduce((n, r) => Math.max(n, r.length), 0); }
  getMaxRows() { return Math.max(1000, this.values.length); }
  getMaxColumns() { return Math.max(26, this.getLastColumn()); }
  setFrozenRows() {}
  deleteRow(row) { this.values.splice(row - 1, 1); }
  getRange(r, c, nr = 1, nc = 1) {
    const sh = this;
    return {
      setNumberFormat() { return this; },
      setDataValidation() { return this; },
      clearContent() {
        for(let i=0;i<nr;i++) for(let j=0;j<nc;j++) if(sh.values[r-1+i]) sh.values[r-1+i][c-1+j] = "";
      },
      getDisplayValues() {
        return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => {
          const val = sh.values[r - 1 + i]?.[c - 1 + j] ?? "";
          return String(val).replace(/^'=/, "=");
        }));
      },
      setValues(rows) {
        assert.equal(rows.length, nr);
        rows.forEach((row, i) => {
          assert.equal(row.length, nc);
          while (sh.values.length < r + i) sh.values.push([]);
          row.forEach((v, j) => { sh.values[r - 1 + i][c - 1 + j] = v; });
        });
      },
      setValue(v) {
        while (sh.values.length < r) sh.values.push([]);
        sh.values[r - 1][c - 1] = v;
      }
    };
  }
}
class Book {
  constructor(sheets) { this.sheets = sheets; }
  getId() { return "copy-id"; }
  getSheetByName(name) { return this.sheets.find(s => s.name === name) || null; }
  insertSheet(name) {
    const sh = new Sheet(name, 123456 + this.sheets.length, []);
    this.sheets.push(sh);
    return sh;
  }
}
const standard = ["Contact / Team", "Priority", "Goal", "Owner", "Status", "Action Steps", "Project", "Deliverable", "Last Time Connected", "Location Met", "Communication Method Used"];
const artizen = ["Contact / Team", "Priority", "Type", "Owner", "Status", "Action Steps", "Project", "Last Time Connected", "Location Met", "Communication Method Used"];
const fixture = [
  ["Stacks", 48], ["SSE/IRL", 32], ["Artizen", 28],
  ["Devconnect 2025", 25], ["Critical Technologist Collective?", 21],
  ["Neo bank", 19], ["Safety net", 13], ["Berlin Blockchain Week 2026", 8],
  ["Client work", 8], ["Solidarity Fund", 6]
];
const sheets = fixture.map(([name, n], i) => {
  const isArt = name === "Artizen", head = isArt ? artizen : standard;
  const rows = name === "Neo bank" ? [[], head] : [head];
  for (let k = 1; k <= n; k++) {
    const obj = {
      "Contact / Team": `${name} Person ${k}`, Priority: k === 1 ? "High" : "",
      Goal: "goal", Type: "funding", Owner: "blessing?", Status: k === 2 ? "Contacted" : "",
      "Action Steps": "call", Project: "project", Deliverable: "deliverable",
      "Last Time Connected": k === 1 ? "24Feb 2025" : k === 2 ? "not a date" : "",
      "Location Met": "Berlin", "Communication Method Used": "private@example.org"
    };
    rows.push(head.map(h => obj[h] || ""));
  }
  return new Sheet(name, name === "Devconnect 2025" ? 0 : i + 111, rows);
});
sheets[0].values[1][10] = '=HYPERLINK("https://example.org", "test")';
const book = new Book(sheets);
let locks = 0;
const sandbox = {
  SpreadsheetApp: {
    openById(id) { assert.equal(id, "copy-id"); return book; },
    newDataValidation: () => ({
      requireValueInRange() { return this; }, requireValueInList() { return this; },
      setAllowInvalid() { return this; }, build() { return this; }
    })
  },
  LockService: { getScriptLock: () => ({ tryLock() { locks++; return true; }, releaseLock() { locks--; } }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
    computeDigest: (_, value) => Array.from(crypto.createHash("sha256").update(value).digest(), x => x > 127 ? x - 256 : x)
  }
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "crm-migration.gs"), "utf8"), sandbox);
const preview = sandbox.breadCrmPreviewCopy("copy-id");
assert.equal(preview.sourceTotal, 208);
assert.equal(preview.datesRaw, 20);
assert.equal(book.getSheetByName("Contacts"), null, "preview is read-only");
assert.throws(() => sandbox.breadCrmMigrateCopy("1c4PgSHC2N2n7VsFHhYH0PMvtQljvZg-ZQo6MtOojVYY"), /forbidden/);
assert.throws(() => sandbox.breadCrmMigrateCopy("19Lxe0C14BOYbOj0Z0nyoQc4-I_aw_jgybcq9LggfcUw"), /forbidden/);
assert.throws(() => sandbox.breadCrmMigrateCopy(""), /forbidden/);
const missing = book.sheets.pop();
assert.throws(() => sandbox.breadCrmMigrateCopy("copy-id"), /Missing legacy tab/);
assert.equal(book.getSheetByName("Contacts"), null, "bad source never creates target");
book.sheets.push(missing);
const header = sheets[0].values[0][5];
sheets[0].values[0][5] = "Unexpected action header";
assert.throws(() => sandbox.breadCrmMigrateCopy("copy-id"), /Missing action steps/);
assert.equal(book.getSheetByName("Contacts"), null, "schema drift never creates target");
sheets[0].values[0][5] = header;

let result = sandbox.breadCrmMigrateCopy("copy-id");
assert.equal(result.added, 208);
assert.equal(result.updated, 0);
assert.equal(result.total, 208);
assert.equal(result.unparsedDates.length, 10);
assert.equal(locks, 0);
const contacts = book.getSheetByName("Contacts"), map = book.getSheetByName("_migration_map");
assert.equal(contacts.getLastRow(), 209);
assert.equal(map.getLastRow(), 209);
assert.equal(book.getSheetByName("Campaigns").getLastRow(), 11);
assert.equal(contacts.values[1][14], "2025-02-24");
assert.equal(contacts.values[2][22], "unparsed date");
assert.equal(contacts.values[1][16], "'" + sheets[0].values[1][10], "formula-like source text escaped");
assert.equal(contacts.values[2][16], "private@example.org", "coordinates kept in source table");
assert.equal(contacts.values[1][20], 2);
const neo = map.values.find(r => r[0] === "Neo bank");
assert.equal(neo[1], 3, "header on row 2 skipped, original row preserved");
const dev = map.values.find(r => r[0] === "Devconnect 2025");
assert.equal(dev[2], 0, "gid zero is retained, never used to find tab");
assert.equal(contacts.values[map.values.find(r => r[0] === "Artizen")[4] - 1][8], "funding");
assert.equal(sandbox.breadCrmValidateCopy("copy-id").ok, true);
assert.equal(result.counts["Stacks"], 48);

const oldId = contacts.values[1][0], oldTime = contacts.values[1][18];
result = sandbox.breadCrmMigrateCopy("copy-id");
assert.equal(result.added, 0);
assert.equal(result.updated, 0);
assert.equal(contacts.values[1][18], oldTime);
assert.equal(contacts.values[1][0], oldId);

contacts.values[1][4] = "Organisation (manual)";
sheets[0].values[1][1] = "Immediate";
result = sandbox.breadCrmMigrateCopy("copy-id");
assert.equal(result.updated, 1);
assert.equal(contacts.values[1][0], oldId, "ID survives edit");
assert.equal(contacts.values[1][4], "Organisation (manual)", "optional Org survives delta update");
assert.equal(contacts.values[1][5], "Immediate");

sheets[0].values.push(["New Person", "", "", "", "", "", "", "", "", "", ""]);
result = sandbox.breadCrmMigrateCopy("copy-id");
assert.equal(result.added, 1);
assert.equal(result.total, 209);
assert.equal(sandbox.breadCrmValidateCopy("copy-id").ok, true);

sheets[0].values.splice(2, 0, ["Inserted mid-sheet", "", "", "", "", "", "", "", "", "", ""]);
assert.throws(() => sandbox.breadCrmMigrateCopy("copy-id"), /Legacy row now names a different contact/);
sheets[0].values.splice(2, 1);
const removed = sheets[0].values.pop();
assert.throws(() => sandbox.breadCrmMigrateCopy("copy-id"), /Mapped legacy row disappeared/);
sheets[0].values.push(removed);

contacts.values[1][5] = "High"; // manual edit of a migration-managed field
const before = JSON.stringify(book.sheets.map(s => s.values));
assert.throws(() => sandbox.breadCrmMigrateCopy("copy-id"), /Conflicting migration map/);
assert.equal(JSON.stringify(book.sheets.map(s => s.values)), before, "conflict fails before any writes");
assert.equal(sandbox.breadCrmValidateCopy("copy-id").ok, false);
assert.equal(locks, 0);
contacts.values[1][5] = "Immediate";

assert.equal(sandbox.CrmMigration.dateValue("Jan 2025"), "2025-01-01");
assert.equal(sandbox.CrmMigration.dateValue("2Mar 2026"), "2026-03-02");
assert.equal(sandbox.CrmMigration.dateValue("13/10/2026"), "2026-10-13");
assert.equal(sandbox.CrmMigration.dateValue("10/13/2026"), "2026-10-13");
assert.equal(sandbox.CrmMigration.dateValue("2026-02-30"), "");
assert.equal(sandbox.CrmMigration.dateValue("bad"), "");

console.log("CRM copy-only migration harness: passed");

// Standalone endpoint tests run on the migrated synthetic copy, not Google.
const props = { CRM_SPREADSHEET_ID: "copy-id", CRM_WRITE_TOKEN: "x".repeat(40) };
let uuid = 0;
sandbox.Utilities.getUuid = () => (++uuid).toString(16).padStart(16, "0") + "a".repeat(16);
sandbox.PropertiesService = { getScriptProperties: () => ({ getProperty: key => props[key] }) };
sandbox.ContentService = {
  MimeType: { JSON: "json" },
  createTextOutput: value => ({ value, setMimeType() { return this; } })
};
sandbox.console = { error() {} };
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "crm-write.gs"), "utf8"), sandbox);
book.sheets.push(new Sheet("History", 991, [
  ["Timestamp", "Op", "Campaign", "Contact", "Detail", "By"],
  ["2026-10-14", "update", "Stacks", "Legacy Person", "Priority", "dashboard"],
  ["2026-10-14", "update", "Stacks", "Stacks Person 1", "Priority", "dashboard"]
]));
book.sheets.push(new Sheet("Links", 992, [
  ["Timestamp", "Type", "LeftCampaign", "LeftRow", "LeftContact", "RightCampaign", "RightRow", "RightContact", "Note", "By"],
  ["2026-10-14", "person", "Stacks", "2", "Stacks Person 1", "Stacks", "3", "Stacks Person 2", "", "dashboard"]
]));
const prep = sandbox.breadCrmPrepareWriteSchemaCopy();
assert.equal(prep.ok, true);assert.equal(prep.historyBackfilled,1);assert.equal(prep.linkSidesBackfilled,2);assert.equal(prep.unresolvedHistory,1);
assert.equal(book.getSheetByName("History").values[1][3], "Legacy Person");
assert.equal(book.getSheetByName("History").values[0][6], "ContactID");
assert.equal(book.getSheetByName("Links").values[0][10], "LeftContactID");
assert.equal(book.getSheetByName("History").values[2][6],oldId);
assert.equal(book.getSheetByName("Links").values[1][10],oldId);
assert.equal(sandbox.breadCrmPrepareWriteSchemaCopy().ok, true, "schema preparation is idempotent");
function post(body, token = props.CRM_WRITE_TOKEN) {
  return JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ token, ...body }) } }).value);
}
assert.equal(post({ op: "contact.update", contactId: oldId, patch: { Priority: "Low" } }, "bad").ok, false);
assert.equal(post({ op: "contact.update", contactId: oldId, patch: { ContactID: "overwrite" } }).ok, false);
assert.equal(post({ op: "contact.update", contactId: oldId, patch: { Priority: "Low", Status: "Typo" } }).ok, false);
assert.equal(contacts.values[1][5], "Immediate", "invalid patch makes no partial update");
assert.equal(post({ op: "contact.update", contactId: oldId, patch: { Priority: "Low", Notes: "private notes" } }).ok, true);
assert.equal(contacts.values[1][5], "Low");
const history = book.getSheetByName("History");
assert.equal(history.values[history.values.length - 1][6], oldId);
assert.equal(JSON.stringify(history.values).includes("private notes"), false, "history omits private values");
assert.equal(post({ op: "contact.update", contactId: oldId, patch: { LastConnectedDate: "2026-02-30" } }).ok, false);
assert.equal(post({ op: "contact.mark", contactId: oldId }).ok, true);
assert.equal(contacts.values[1][6], "Contacted");
assert.match(contacts.values[1][14], /^\d{4}-\d{2}-\d{2}$/);
const campaignResult = post({ op: "campaign.create", name: "New test campaign", owner: "Josh" });
assert.equal(campaignResult.ok, true);
assert.equal(post({ op: "campaign.create", name: "new TEST campaign" }).ok, false);
const added = post({ op: "contact.add", campaignId: campaignResult.campaignId, fields: { Contact: "Synthetic test", Method: "private@test.invalid" } });
assert.equal(added.ok, true);
const rowsBeforeArchive = contacts.values.length;
assert.equal(post({ op: "campaign.archive", campaignId: campaignResult.campaignId }).ok, true);
assert.equal(contacts.values.length, rowsBeforeArchive, "archive never removes contacts");
assert.equal(post({ op: "contact.add", campaignId: campaignResult.campaignId, fields: { Contact: "Disallowed" } }).ok, false);
assert.equal(post({ op: "campaign.restore", campaignId: campaignResult.campaignId }).ok, true);
assert.equal(post({ op: "contact.link", leftId: oldId, rightId: added.contactId, type: "same person" }).ok, true);
const links = book.getSheetByName("Links");
assert.equal(links.values.length, 3);
assert.equal(post({ op: "contact.link", leftId: added.contactId, rightId: oldId, type: "same person" }).changed.length, 0);
assert.equal(links.values.length, 3, "reverse link is idempotent");
assert.equal(post({ op: "contact.unlink", leftId: oldId, rightId: added.contactId, type: "same person" }).ok, true);
assert.equal(links.values.length, 2);
assert.equal(post({ op: "contact.link", leftId: oldId, rightId: oldId, type: "same person" }).ok, false);
assert.equal(post({ op: "update", campaign: "Stacks", row: 2 }).ok, false, "legacy writes fail closed");
assert.equal(post({ op: "contact.update", contactId: "missing", patch: { Owner: "Josh" } }).ok, false);
assert.equal(locks, 0);
console.log("CRM standalone write endpoint harness: passed");

const feed = new Book([new Sheet("Contacts", 1045890393, Array.from({length:220}, () => Array(19).fill("old-private-value")))]);
sandbox.SpreadsheetApp.openById = id => {
  if(id === "copy-id") return book;
  if(id === "feed-copy-id") return feed;
  throw new Error("Unexpected spreadsheet ID");
};
vm.runInContext(fs.readFileSync(path.join(__dirname,"..","crm-feed.gs"),"utf8"),sandbox);
assert.throws(() => sandbox.breadCrmRefreshFeedCopy(), /Configure distinct/);
props.CRM_FEED_ID = "19Lxe0C14BOYbOj0Z0nyoQc4-I_aw_jgybcq9LggfcUw";
assert.throws(() => sandbox.breadCrmRefreshFeedCopy(), /production IDs/);
props.CRM_FEED_ID = "feed-copy-id";
// A blank physical source row must not change the locators of following rows.
contacts.values.splice(3,0, Array(23).fill(""));
const projected = sandbox.breadCrmRefreshFeedCopy();
assert.equal(projected.ok,true);
assert.equal(projected.tabs.Contacts.gid,1045890393,"feed tab gid retained");
assert.equal(projected.tabs.Contacts.rows,210);
const feedContacts = feed.getSheetByName("Contacts");
assert.equal(feedContacts.values[0][13],"ContactID");
assert.equal(feedContacts.values[0][14],"CampaignID");
assert.equal(feedContacts.values[3][11],"5","source locator survives physical blank row");
assert.equal(feedContacts.values[1][12],String(contacts.gid));
assert.equal(feedContacts.values[1][13],oldId);
assert.equal(JSON.stringify(feed.sheets.map(s=>s.values)).includes("private@test.invalid"),false,"Method never exported");
assert.equal(JSON.stringify(feed.sheets.map(s=>s.values)).includes("private notes"),false,"Notes never exported");
assert.equal(JSON.stringify(feed.sheets.map(s=>s.values)).includes("old-private-value"),false,"stale rows and columns cleared");
assert.equal(feed.getSheetByName("Campaigns").values.length,12,"empty campaign exported from registry");
const unchangedFeed = JSON.stringify(feed.sheets.map(s=>s.values));
const savedId = contacts.values[2][0];
contacts.values[2][0] = oldId;
assert.throws(() => sandbox.breadCrmRefreshFeedCopy(), /Invalid contact/);
assert.equal(JSON.stringify(feed.sheets.map(s=>s.values)),unchangedFeed,"invalid source makes no feed writes");
contacts.values[2][0] = savedId;
const syncResult = post({op:"contact.update",contactId:oldId,patch:{Owner:"Josh"}});
assert.equal(syncResult.ok,true);
assert.equal(syncResult.feedUpdated,true,"write triggers staging projection when configured");
props.CRM_FEED_ID = "copy-id";
const pendingResult = post({op:"contact.update",contactId:oldId,patch:{Owner:"Unai"}});
assert.equal(pendingResult.ok,true,"projection failure never misreports a committed edit as rejected");
assert.equal(pendingResult.feedUpdated,false);
assert.equal(locks,0);
console.log("CRM staging feed projection harness: passed");
