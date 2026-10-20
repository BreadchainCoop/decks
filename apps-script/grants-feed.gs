/** Aggregate/allowlist grants feed. No notes, warm contacts or application text.
 * GRANTS_SPREADSHEET_ID and GRANTS_FEED_ID must be distinct configured sheets.
 * In staging, known production destinations are blocked by Bh.
 */
var BreadGrantsFeed = (function () {
  function refresh() {
    var sourceId = Bh.prop("GRANTS_SPREADSHEET_ID", ""), feedId = Bh.prop("GRANTS_FEED_ID", "");
    if (!sourceId || !feedId || sourceId === feedId) throw new Error("Configure separate grants source/feed sheets");
    Bh.assertWriteDestination(sourceId); Bh.assertWriteDestination(feedId);
    return Bh.withLock(function () {
      var source = SpreadsheetApp.openById(sourceId), feed = SpreadsheetApp.openById(feedId), sh = source.getSheetByName("Grants");
      if (!sh) throw new Error("Missing Grants tab");
      var table = Bh.readRows(sh), map = table.map;
      if (!map.funder && !map["organizational name"]) throw new Error("Missing grants identity header");
      ["pipeline stage", "team member", "next action", "next action date", "website", "document link"].forEach(function (h) { if (!map[h]) throw new Error("Missing Grants." + h); });
      var counts = { Submitted: 0, Won: 0, Lost: 0 };
      var rows = table.rows.filter(function (o) { return String(o.funder || o["organizational name"] || "").trim(); }).map(function (o) {
        if (o["submitted on"] || /^(Submitted|Follow-up)$/.test(String(o["pipeline stage"]))) counts.Submitted++;
        if (/^won$/i.test(String(o.outcome || ""))) counts.Won++;
        if (/^lost$/i.test(String(o.outcome || ""))) counts.Lost++;
        var due = o["next action date"];
        if (due instanceof Date) due = Bh.fmtDate(due);
        return [o.funder || o["organizational name"], o.category || o["type of grantor"] || "", o.grant || o["grant name"] || "", o["pipeline stage"] || "", o.tier || "", o["next action"] || "", due || "", o["team member"] || "", o.website || "", o["document link"] || "", String(o.__row)];
      });
      var stats = Object.create(null);
      stats["Campaign Goal"] = "100"; stats["Campaign Start"] = ""; stats["Funds Raised (EUR) — confirmed amounts only"] = "0";
      var old = feed.getSheetByName("Stats");
      if (old) {
        var prior = Bh.readRows(old);
        if (!prior.map.metric || !prior.map.value) throw new Error("Unexpected grants Stats schema");
        prior.rows.forEach(function (o) { if (o.metric) stats[String(o.metric)] = String(o.value == null ? "" : o.value); });
      }
      Object.keys(counts).forEach(function (k) { stats[k] = String(counts[k]); });
      var plans = [
        ["Targets", ["Funder", "Category", "Grant", "Stage", "Tier", "NextAction", "Due", "Owner", "Website", "DocLink", "Row"], rows],
        ["Stats", ["Metric", "Value"], Object.keys(stats).sort().map(function (k) { return [k, stats[k]]; })]
      ], result = {};
      plans.forEach(function (plan) {
        var tab = feed.getSheetByName(plan[0]) || feed.insertSheet(plan[0]), values = [plan[1]].concat(plan[2]);
        var nr = tab.getLastRow(), nc = tab.getLastColumn();
        if (tab.getMaxRows() < values.length) tab.insertRowsAfter(tab.getMaxRows(), values.length - tab.getMaxRows());
        if (tab.getMaxColumns() < plan[1].length) tab.insertColumnsAfter(tab.getMaxColumns(), plan[1].length - tab.getMaxColumns());
        tab.getRange(1, 1, values.length, plan[1].length).setNumberFormat("@").setValues(values.map(function (r) { return r.map(function (v) { v = String(v); return v.charAt(0) === "=" ? "'" + v : v; }); }));
        if (nr > values.length) tab.getRange(values.length + 1, 1, nr - values.length, Math.max(nc, plan[1].length)).clearContent();
        if (nc > plan[1].length) tab.getRange(1, plan[1].length + 1, Math.max(nr, values.length), nc - plan[1].length).clearContent();
        result[plan[0]] = { gid: tab.getSheetId(), rows: plan[2].length };
      });
      return { ok: true, tabs: result };
    });
  }
  return { refresh: refresh };
}());
function breadRefreshGrantsFeed() { return BreadGrantsFeed.refresh(); }
