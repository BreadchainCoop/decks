/** Flatten the curated "Merged Pipeline" view into the tabular "Pipeline" tab
 * that the grants feed reads.
 *
 * The view is a report, not a table: it carries section headings
 * ("OPEN NOW … (7)"), subtotal rows and a live "Days left" formula. Projecting
 * it directly would publish headings as grants and freeze a value that goes
 * stale, so it is flattened once here instead.
 *
 * `flatten` is pure and safe to unit-test. `build` rewrites the Pipeline tab in
 * the spreadsheet it is given and never touches any other tab.
 */
var BreadGrantsPipeline = (function () {
  var SOURCE_TAB = "Merged Pipeline";
  var TARGET_TAB = "Pipeline";
  var HEADER_ALIASES = { "est. max (usd, approx.)": "Est. max (USD)" };
  var DERIVED_HEADERS = ["days left"];

  function normHeader(h) {
    var key = String(h == null ? "" : h).trim().toLowerCase();
    return HEADER_ALIASES[key] || String(h == null ? "" : h).trim();
  }

  function indexOfHeader(headers, name) {
    for (var i = 0; i < headers.length; i++) if (headers[i].toLowerCase() === name) return i;
    return -1;
  }

  function isSectionHeading(name, grant) {
    return /\(\d+\)\s*$/.test(name) && !grant;
  }

  function flatten(values) {
    if (!values || !values.length) throw new Error(SOURCE_TAB + " is empty");
    var headers = values[0].map(normHeader);
    var grantIdx = indexOfHeader(headers, "grant name");
    var derived = DERIVED_HEADERS.map(function (h) { return indexOfHeader(headers, h); });
    var rows = [], skipped = 0;
    for (var i = 1; i < values.length; i++) {
      var row = values[i].slice(0, headers.length);
      var name = String(row[0] == null ? "" : row[0]).trim();
      if (!name) { skipped++; continue; }
      var grant = grantIdx >= 0 ? String(row[grantIdx] == null ? "" : row[grantIdx]).trim() : "";
      if (isSectionHeading(name, grant)) { skipped++; continue; }
      derived.forEach(function (idx) { if (idx >= 0) row[idx] = ""; });
      rows.push(row);
    }
    return { headers: headers, rows: rows, skipped: skipped };
  }

  function read(ss) {
    var view = ss.getSheetByName(SOURCE_TAB);
    if (!view) throw new Error("Missing " + SOURCE_TAB + " tab");
    var last = view.getLastRow();
    if (last < 2) throw new Error(SOURCE_TAB + " has no data rows");
    return flatten(view.getRange(1, 1, last, Math.max(view.getLastColumn(), 1)).getDisplayValues());
  }

  function countFilled(rows, headers, name) {
    var idx = indexOfHeader(headers, name);
    if (idx < 0) return 0;
    return rows.filter(function (r) { return String(r[idx] == null ? "" : r[idx]).trim(); }).length;
  }

  function preview(ss) {
    var f = read(ss), target = ss.getSheetByName(TARGET_TAB);
    return {
      ok: true, source: SOURCE_TAB, target: TARGET_TAB, existingTarget: !!target,
      rows: f.rows.length, skipped: f.skipped, cols: f.headers.length,
      withDeadline: countFilled(f.rows, f.headers, "deadline (date)"),
      withEstimate: countFilled(f.rows, f.headers, "est. max (usd)"),
      withSource: countFilled(f.rows, f.headers, "source"),
      headers: f.headers
    };
  }

  function build(ss) {
    var f = read(ss), target = ss.getSheetByName(TARGET_TAB) || ss.insertSheet(TARGET_TAB);
    target.clear();
    target.getRange(1, 1, 1, f.headers.length).setValues([f.headers]);
    if (f.rows.length) target.getRange(2, 1, f.rows.length, f.headers.length).setValues(f.rows);
    return { ok: true, gid: target.getSheetId(), rows: f.rows.length, cols: f.headers.length, skipped: f.skipped };
  }

  return { flatten: flatten, preview: preview, build: build, SOURCE_TAB: SOURCE_TAB, TARGET_TAB: TARGET_TAB };
}());

function breadGrantsPipelineSheet_() {
  var id = Bh.prop("GRANTS_SPREADSHEET_ID", "");
  if (!id) throw new Error("GRANTS_SPREADSHEET_ID is not configured");
  return SpreadsheetApp.openById(id);
}

/** Read-only: what would be flattened, and what is already there. */
function breadGrantsPipelinePreview() {
  return BreadGrantsPipeline.preview(breadGrantsPipelineSheet_());
}

/** Rebuilds the Pipeline tab. Deliberately requires an explicit flag so a
 * preview never turns into a write by accident; no other tab is modified. */
function breadGrantsPipelineBuild() {
  var ss = breadGrantsPipelineSheet_();
  if (Bh.prop("GRANTS_PIPELINE_APPLY", "") !== "true") {
    return { ok: false, error: "Set GRANTS_PIPELINE_APPLY=true to write the Pipeline tab", preview: BreadGrantsPipeline.preview(ss) };
  }
  return BreadGrantsPipeline.build(ss);
}
