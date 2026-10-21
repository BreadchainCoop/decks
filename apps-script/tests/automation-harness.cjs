#!/usr/bin/env node
/* Node harness: runs the automation .gs files against a fake Sheets API.
 *   node apps-script/tests/automation-harness.cjs
 * No Google access, no credentials. Exit code 1 on failure.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");

class Sheet {
  constructor(name, values, gid) { this.name = name; this.values = values || []; this.gid = gid || 0; }
  getName() { return this.name; }
  getSheetId() { return this.gid; }
  getLastRow() { return this.values.length; }
  getLastColumn() { return this.values.reduce((m, r) => Math.max(m, r.length), 0); }
  _ensure(row, col) {
    while (this.values.length < row) this.values.push([]);
    const r = this.values[row - 1];
    while (r.length < col) r.push("");
  }
  getRange(row, col, nr = 1, nc = 1) {
    const self = this;
    return {
      getValues() {
        const out = [];
        for (let r = 0; r < nr; r++) {
          const rowVals = [];
          for (let c = 0; c < nc; c++) rowVals.push((self.values[row - 1 + r] || [])[col - 1 + c] ?? "");
          out.push(rowVals);
        }
        return out;
      },
      getValue() { return (this.single = (self.values[row - 1] || [])[col - 1] ?? ""); },
      setValue(v) { self._ensure(row, col); self.values[row - 1][col - 1] = v; },
      setValues(vals) {
        vals.forEach((rv, i) => rv.forEach((v, j) => {
          self._ensure(row + i, col + j);
          self.values[row - 1 + i][col - 1 + j] = v;
        }));
      },
      setFontWeight() { return this; }
    };
  }
  appendRow(vals) { this.values.push(vals.slice()); }
  setFrozenRows() { return this; }
}

class Book {
  constructor(sheets) { this.sheets = sheets; }
  getSheets() { return this.sheets; }
  getSheetByName(n) { return this.sheets.find(s => s.getName() === n) || null; }
  insertSheet(n) { const s = new Sheet(n, []); this.sheets.push(s); return s; }
}

const pad = n => String(n).padStart(2, "0");
const dstr = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const daysAgo = n => new Date(Date.now() - n * 864e5);

const workTasks = new Sheet("Tasks", [
  ["Task", "Project", "Owner", "Status", "Priority", "Due", "Contact / Org", "Grant", "KB link", "Notes", "Blocked by", "Subtasks", "Start"],
  ["Overdue thing", "Ops", "Unai", "In progress", "High", daysAgo(2), "", "", "", "", "", "", ""],
  ["Blocked thing", "Ops", "Ruben", "Blocked", "Medium", daysAgo(-5), "", "", "", "", "", "", ""],
  ["Unowned thing", "Ops", "", "In progress", "Medium", daysAgo(-9), "", "", "", "", "", "", ""],
  ["Stale thing", "Ops", "Josh", "In progress", "Low", daysAgo(-12), "", "", "", "", "", "", ""],
  ["WIP 1", "Ops", "Blessing", "In progress", "Low", "", "", "", "", "", "", ""],
  ["WIP 2", "Ops", "Blessing", "In progress", "Low", "", "", "", "", "", "", ""],
  ["WIP 3", "Ops", "Blessing", "In progress", "Low", "", "", "", "", "", "", ""],
  ["WIP 4", "Ops", "Blessing", "In progress", "Low", "", "", "", "", "", "", ""],
  ["Old done thing", "Ops", "Unai", "Done", "Low", daysAgo(30), "", "", "", "", "", "", ""]
]);
const workHistory = new Sheet("History", [
  ["Timestamp", "Op", "Task", "Detail", "By"],
  [daysAgo(40), "update", "Stale thing", "status", "deck"],
  [daysAgo(1), "update", "Overdue thing", "status", "deck"]
]);
const workBook = new Book([workTasks, workHistory]);

const interest = new Sheet("New Form Responses 25 Sept 2025", [
  ["Timestamp", "What is your name?", "Status", "Contact perons in BC core", "What is your discord handle?",
    "What is your email?", "What is your preferred method of contact?", "How many hours are you available to contribute weekly?",
    "Are you interested in being involved in governance of the Breadchain Cooperative?",
    "Are you interested in contributing software skills?", "Non-software?", "Dev skills?", "Capacity?",
    "Experience?", "Background?", "Portfolio?", "", "", "Value aligned ", "Skills needed", "Vibe", "Reliability", "Others"],
  [daysAgo(40), "Old Unassigned", "", "", "", "old@example.org", "email", 4, "Yes", "Yes", "", "", "", "", "", "", "", "", "", "", "", "", ""],
  [daysAgo(10), "Owned Waiting", "", "Unai", "", "", "discord", 8, "Maybe", "No", "", "", "", "", "", "", "", "", "", "", "", "", ""]
]);
const contribBook = new Book([interest]);

const crmFeed = new Sheet("Contacts", [
  ["Campaign", "Contact", "Priority", "Goal", "Owner", "Status", "Action", "Project", "Deliverable", "LastConnected", "LocationMet", "Row", "GID"],
  ["Stacks", "Stale Sam", "High", "intro", "Ron", "Contacted", "follow up", "stacks", "", daysAgo(60), "", "8", "600207923"],
  ["Stacks", "Fresh Fay", "Low", "intro", "Ron", "Contacted", "call", "stacks", "", daysAgo(10), "", "9", "600207923"],
  ["SSE/IRL", "Unowned Uma", "Immediate", "partner", "", "Not contacted", "reach out", "sse", "", "", "", "4", "777"],
  ["Neo bank", "Blocked Bob", "Medium", "bank", "Josh", "Blocked", "waiting", "neo", "", daysAgo(5), "", "3", "888"],
  ["Artizen", "Done Dee", "High", "done", "", "Completed", "", "art", "", "", "", "2", "999"],
  ["Stacks", "No Date Nia", "Low", "intro", "Bren", "Contacted", "call", "stacks", "", "", "", "10", "600207923"]
], 1045890393);
const crmBook = new Book([crmFeed]);

const BOOKS = {
  "10vQRSVpiePANd1yNzSyua_PO5DCgk9muB_VqYIFDAkE": workBook,
  "1ncGbPZyf0vH9NCsndvaUkmkJremWz1YW1_-YPpLRjxA": contribBook,
  "19Lxe0C14BOYbOj0Z0nyoQc4-I_aw_jgybcq9LggfcUw": crmBook
};

const props = {};
const sandbox = {
  console,
  SpreadsheetApp: { openById: id => BOOKS[id] },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: k => { delete props[k]; }
    })
  },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  ContentService: {
    MimeType: { JSON: "json" },
    createTextOutput: text => ({ text, setMimeType() { return this; }, getContentText() { return this.text; } })
  },
  Utilities: { formatDate: d => dstr(d) },
  Session: { getScriptTimeZone: () => "UTC" }
};
vm.createContext(sandbox);
["bh-lib.gs", "jobs-work.gs", "jobs-contributors.gs", "jobs-crm.gs"].forEach(f => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox, { filename: f });
});

const results = [];
const check = (label, ok, extra) => results.push({ label, ok: !!ok, ...(ok ? {} : { extra }) });
const inbox = () => {
  const sh = workBook.getSheetByName("Agent Inbox");
  if (!sh) return [];
  const head = sh.values[0] || [];
  return sh.values.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
};
const inboxRows = () => inbox().length;

/* ── date helper ─────────────────────────────────────────────────────── */
check("parse yyyy-mm-dd", dstr(sandbox.Bh.parseDate("2026-10-06")) === "2026-10-06");
check("parse day-first", dstr(sandbox.Bh.parseDate("13/10/2026")) === "2026-10-13");
check("parse month-first", dstr(sandbox.Bh.parseDate("10/13/2026")) === "2026-10-13");
check("parse gviz Date()", dstr(sandbox.Bh.parseDate("Date(2026,9,6)")) === "2026-10-06");

/* ── work hygiene ────────────────────────────────────────────────────── */
let r = sandbox.breadWorkHygiene();
check("work first run notifies", /notified|unchanged/.test(r), r);
const firstWork = inbox().filter(e => e.Source === "work");
check("work wrote one event", firstWork.length === 1, firstWork);
const wp = JSON.parse(firstWork[0].Payload);
check("overdue counted", wp.counts.overdue === 1, wp.counts);
check("blocked counted", wp.counts.blocked === 1, wp.counts);
check("unowned counted", wp.counts.unowned === 1, wp.counts);
check("stale counted", wp.counts.stale === 1, wp.counts);
check("over WIP counted", wp.counts.overWip === 1, wp.counts);
check("handled blank", firstWork[0].Handled === "", firstWork[0].Handled);

r = sandbox.breadWorkHygiene();
check("work second run unchanged", r === "unchanged", r);
check("work no duplicate event", inbox().filter(e => e.Source === "work").length === 1);

/* fix everything, then confirm the signature clears */
workTasks.values.forEach(row => {
  if (row[2] === "Blessing") row[3] = "Backlog";
  if (row[0] === "Overdue thing") row[3] = "Done";
  if (row[0] === "Blocked thing") row[3] = "Done";
  if (row[0] === "Unowned thing") row[3] = "Done";
  if (row[0] === "Stale thing") row[3] = "Done";
});
r = sandbox.breadWorkHygiene();
check("work clears when fixed", r === "clear", r);
check("work clear removes sig", !("sig:work:hygiene" in props));

/* recurrence notifies again */
workTasks.values[1][3] = "In progress";
workTasks.values[1][5] = daysAgo(2);
r = sandbox.breadWorkHygiene();
check("work recurrence notifies", /notified/.test(r), r);
check("work recurrence adds row", inbox().filter(e => e.Source === "work").length === 2);

/* ── contributor gate ────────────────────────────────────────────────── */
r = sandbox.breadContributorGate();
check("contributor baseline silent", r.indexOf("baseline") === 0, r);
check("contributor baseline no event", inbox().filter(e => e.Source === "contributors").length === 0);
check("contributor cursor set", !!props["cursor:contributors"]);

interest.values.push([new Date(), "New Person", "", "", "", "new@example.org", "email", 5, "Yes", "Yes", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
r = sandbox.breadContributorGate();
const cEvents = inbox().filter(e => e.Source === "contributors");
check("contributor new signup notifies", /notified/.test(r), r);
check("contributor one event", cEvents.length === 1, cEvents);
const cp = JSON.parse(cEvents[0].Payload);
check("new signup counted", cp.counts.new === 1, cp.counts);
check("no-owner 7d counted", cp.counts.noOwner7d === 1, cp.counts);
check("waiting 30d counted", cp.counts.waiting30d === 1, cp.counts);
check("new signup named", cp.new[0].name === "New Person", cp.new);

r = sandbox.breadContributorGate();
check("contributor unchanged second run", r === "unchanged", r);
check("contributor no duplicate", inbox().filter(e => e.Source === "contributors").length === 1);

/* ── CRM follow-ups ──────────────────────────────────────────────────── */
r = sandbox.breadCrmFollowups();
const crmEvents = inbox().filter(e => e.Source === "crm");
check("crm notifies", /notified/.test(r), r);
check("crm one event", crmEvents.length === 1, crmEvents);
const crp = JSON.parse(crmEvents[0].Payload);
check("crm stale 45d", crp.counts.stale45 === 1, crp.counts);
check("crm unowned high", crp.counts.unownedHigh === 1, crp.counts);
check("crm blocked", crp.counts.blocked === 1, crp.counts);
check("crm no-date counted", crp.counts.noDate === 1, crp.counts);
check("crm excludes completed", !JSON.stringify(crp).includes("Done Dee"), crp);

r = sandbox.breadCrmFollowups();
check("crm unchanged second run", r === "unchanged", r);

/* ── inbox shape ─────────────────────────────────────────────────────── */
const sh = workBook.getSheetByName("Agent Inbox");
check("inbox headers", sh.values[0].join("|") === "Timestamp|Source|Kind|Severity|Ref|Summary|Payload|Handled", sh.values[0]);

const bad = results.filter(x => !x.ok);
console.log(JSON.stringify({ passed: results.length - bad.length, failed: bad.length, bad }, null, 2));
process.exit(bad.length ? 1 : 0);
