/** Stable grant row writes. Requires caller-supplied exact funder + optional
 * row hint; ambiguous funder labels reject instead of updating the first hit.
 * Header-based, no guessed column numbers. No external sends or stage automation.
 */
var BreadGrants = (function () {
  var WRITABLE = ["Pipeline Stage", "Team Member", "Next Action", "Next Action Date", "Document Link", "Outcome"];
  var STAGES = ["Sourced", "Qualified", "Asset-ready", "Drafting", "Internal review", "Submitted", "Follow-up", "Outcome"];
  function handle(body, ss) {
    var sh = ss.getSheetByName("Grants") || ss.getSheetByName("Targets");
    if (!sh) throw new Error("Missing Grants/Targets tab");
    var width = sh.getLastColumn(), head = sh.getRange(1, 1, 1, width).getDisplayValues()[0], map = Object.create(null);
    head.forEach(function (h, i) { var k = h.trim().toLowerCase(); if (map[k] !== undefined) throw new Error("Duplicate grant header"); map[k] = i; });
    if (map.funder === undefined && map["organizational name"] !== undefined) map.funder = map["organizational name"];
    var funderCol = map.funder;
    if (funderCol === undefined) throw new Error("Missing Funder header");
    if (typeof body.funder !== "string" || !body.funder.trim()) throw new Error("Funder required");
    // Multi-programme funders (two rows, same org) are addressable only when the
    // caller also names the grant; without it an ambiguous funder still rejects.
    var grantCol = map.grant !== undefined ? map.grant : map["grant name"];
    var wantGrant = typeof body.grant === "string" ? body.grant.trim().toLowerCase() : "";
    var rows = sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, width).getDisplayValues();
    var hits = [];
    rows.forEach(function (r, i) {
      if (String(r[funderCol]).trim().toLowerCase() !== body.funder.trim().toLowerCase()) return;
      if (wantGrant && grantCol !== undefined && String(r[grantCol]).trim().toLowerCase() !== wantGrant) return;
      hits.push({ row: i + 2, values: r });
    });
    if (hits.length !== 1) throw new Error(wantGrant ? "Funder/grant missing or ambiguous" : "Funder missing or ambiguous");
    var item = hits[0], patch = body.op === "grants.stage" ? { "Pipeline Stage": body.stage } : body.patch;
    if (!patch || typeof patch !== "object" || Array.isArray(patch) || !Object.keys(patch).length) throw new Error("Patch required");
    var allowed = {};
    WRITABLE.forEach(function (h) { allowed[h] = true; });
    Object.keys(patch).forEach(function (h) {
      var v = patch[h];
      if (!allowed[h] || map[h.toLowerCase()] === undefined || typeof v !== "string" || v.length > 20000) throw new Error("Invalid grant field");
      if (h === "Pipeline Stage" && STAGES.indexOf(v) < 0) throw new Error("Invalid pipeline stage");
      if (h === "Next Action Date" && v && !BreadHq.validDate(v)) throw new Error("Invalid grant date");
      if (h === "Document Link" && v && !BreadHq.validUrl(v)) throw new Error("Invalid document URL");
    });
    // Audit schema is checked before any data writes.
    var hist = ss.getSheetByName("History"), histHeaders = ["Timestamp", "Op", "Funder", "Fields", "By"];
    if (hist && (hist.getLastColumn() !== 5 || hist.getRange(1, 1, 1, 5).getDisplayValues()[0].some(function (h, i) { return h !== histHeaders[i]; }))) throw new Error("Unexpected grants History schema");
    var changed = Object.keys(patch).filter(function (h) { return item.values[map[h.toLowerCase()]] !== patch[h]; });
    if (!changed.length) return { ok: true, row: item.row, changed: [] };
    if (!hist) { hist = ss.insertSheet("History"); hist.getRange(1, 1, 1, 5).setValues([histHeaders]); }
    changed.forEach(function (h) {
      var v = patch[h];
      sh.getRange(item.row, map[h.toLowerCase()] + 1).setNumberFormat("@").setValue(v.charAt(0) === "=" ? "'" + v : v);
    });
    hist.appendRow([new Date().toISOString(), body.op, body.funder, changed.join(", "), "suite"].map(function (v) { return String(v).charAt(0) === "=" ? "'" + v : v; }));
    return { ok: true, row: item.row, changed: changed };
  }
  return { handle: handle };
}());
