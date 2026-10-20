#!/usr/bin/env node
/* one-off: dump both contributor-form tabs via public gviz to raw JSON files */
const fs = require("fs");
const SSID = "1ncGbPZyf0vH9NCsndvaUkmkJremWz1YW1_-YPpLRjxA";
const tabs = [
  { slug: "legacy", name: "Form Responses 1" },
  { slug: "active", name: "New Form Responses 25 Sept 2025" },
];
(async () => {
  for (const t of tabs) {
    const url = `https://docs.google.com/spreadsheets/d/${SSID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(t.name)}`;
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" } });
    const text = await res.text();
    const json = JSON.parse(text.replace(/^.*?setResponse\(/s, "").replace(/\);?\s*$/, ""));
    const out = {
      tab: t.name,
      cols: json.table.cols.map(c => c.label || ""),
      rows: (json.table.rows || []).map(r => (r.c || []).map(c => (c && c.v !== undefined && c.v !== null) ? String(c.v) : "")),
    };
    fs.writeFileSync(__dirname + `/raw-${t.slug}.json`, JSON.stringify(out, null, 1));
    console.log(t.slug, "cols:", out.cols.length, "rows:", out.rows.length);
  }
})();
