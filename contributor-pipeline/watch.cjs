#!/usr/bin/env node
/* Contributor signup watcher — daily script gate (zero-token when quiet)
 * Monitors ONLY the live tab "New Form Responses 25 Sept 2025" of the
 * Contributor Interest Form sheet. Wake when the count of real signup rows
 * (has name + Date() timestamp) grows vs state.json. Sends the new rows.
 * Prints {wakeAgent, data} — follow RUNBOOK.md when woken. */
const fs = require("fs"), path = require("path");
const DIR = __dirname;
const STATE = path.join(DIR, "state.json");
const SSID = "1ncGbPZyf0vH9NCsndvaUkmkJremWz1YW1_-YPpLRjxA";
const TAB = "New Form Responses 25 Sept 2025";
const COLS = ["timestamp","name","status","contactPerson","discord","email","pref","hours","governance","software","nonSoftware","devSkills","capacity","experience","background","github"];

const watchdog = setTimeout(() => { console.log(JSON.stringify({ wakeAgent: false, data: { error: "watchdog 12s timeout — skipped this run" } })); process.exit(0); }, 12000);

(async () => {
  try {
    const prev = (() => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return null; } })();
    const url = `https://docs.google.com/spreadsheets/d/${SSID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(TAB)}`;
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" } });
    if (!res.ok) { console.log(JSON.stringify({ wakeAgent: false, data: { error: `fetch ${res.status}` } })); return; }
    const text = await res.text();
    const json = JSON.parse(text.replace(/^.*?setResponse\(/s, "").replace(/\);?\s*$/, ""));
    const rows = (json.table.rows || []).map(r => (r.c || []).map(c => (c && c.v !== undefined && c.v !== null) ? String(c.v) : ""));
    const real = rows.filter(r => (r[1] || "").trim() && /^Date\(/.test(r[0] || "")); /* name + timestamp = real signup (skips marker rows) */

    if (!prev) { fs.writeFileSync(STATE, JSON.stringify({ count: real.length }, null, 1)); console.log(JSON.stringify({ wakeAgent: false, data: { baseline: real.length } })); return; }
    if (real.length <= prev.count) { fs.writeFileSync(STATE, JSON.stringify({ count: real.length }, null, 1)); console.log(JSON.stringify({ wakeAgent: false, data: { count: real.length } })); return; }

    const newRows = real.slice(prev.count).map(r => {
      const o = {};
      COLS.forEach((k, i) => { o[k] = (r[i] || "").trim(); });
      return o;
    });
    fs.writeFileSync(STATE, JSON.stringify({ count: real.length }, null, 1));
    console.log(JSON.stringify({ wakeAgent: true, data: { newSignups: newRows, total: real.length } }));
  } finally { clearTimeout(watchdog); }
})().catch(e => { clearTimeout(watchdog); console.log(JSON.stringify({ wakeAgent: false, data: { error: String(e.message).slice(0, 200) } })); });
