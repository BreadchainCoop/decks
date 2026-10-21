/** Cross-sheet rollup, instant contributor gate and HQ date boundaries.
 * All emit compact events only; no email, chat or model call is made here.
 */
function breadWeeklyRollup() {
  return Bh.withLock(function () {
    var sources = [
      ["work", Bh.WORK_SS_ID, "Tasks", "task"],
      ["crm", Bh.CRM_FEED_ID, "Contacts", "contact"],
      ["contributors", Bh.CONTRIB_SS_ID, "", "what is your name?"],
      ["grants", Bh.prop("GRANTS_SPREADSHEET_ID", ""), "Grants", "funder"]
    ];
    var counts = {}, missing = [];
    sources.forEach(function (source) {
      if (!source[1]) { missing.push(source[0]); return; }
      var ss = SpreadsheetApp.openById(source[1]);
      var sh = source[2] ? ss.getSheetByName(source[2]) : Bh.sheetByRegex(ss, /^new form responses/i);
      if (!sh && source[0] === "grants") sh = ss.getSheetByName("Targets");
      if (!sh) { missing.push(source[0]); return; }
      var data = Bh.readRows(sh).rows.filter(function (o) { return String(o[source[3]] || (source[0] === "grants" ? o["organizational name"] : "") || "").trim(); });
      counts[source[0]] = { total: data.length, statuses: {} };
      data.forEach(function (o) {
        var status = String(o.status || o["pipeline stage"] || "(blank)");
        counts[source[0]].statuses[status] = (counts[source[0]].statuses[status] || 0) + 1;
      });
    });
    if (!Object.keys(counts).length) return "not-configured";
    var payload = { counts: counts, missing: missing };
    var wrote = Bh.notify({ source: "suite", kind: "weekly-rollup", severity: "info", ref: "suite",
      summary: "Suite totals changed: " + Object.keys(counts).map(function (s) { return s + " " + counts[s].total; }).join(", "),
      payload: payload, sig: JSON.stringify(payload) });
    return wrote ? "notified" : "unchanged";
  });
}

function breadContributorFormSubmit(e) {
  // Installable spreadsheet form-submit trigger, not a public web operation.
  if (!e || !e.range || !e.source || e.source.getId() !== Bh.CONTRIB_SS_ID) return "ignored";
  if (!/^new form responses/i.test(e.range.getSheet().getName())) return "ignored";
  // Use exactly the daily gate and cursor; do not create a second event stream.
  // The installer seeds the baseline before enabling this trigger.
  return breadContributorGate();
}

function breadHqBoundaries() {
  var id = Bh.prop("HQ_SPREADSHEET_ID", "");
  if (!id) return "not-configured";
  return Bh.withLock(function () {
    var ss = SpreadsheetApp.openById(id), today = Bh.fmtDate(Bh.today());
    var timeoff = ss.getSheetByName("TimeOff"), directives = ss.getSheetByName("Directives");
    if (!timeoff || !directives) return "HQ setup required";
    var away = Bh.readRows(timeoff).rows.filter(function (o) { return o.status === "Active" && String(o.start) <= today && String(o.end) >= today; })
      .map(function (o) { return { id: o.timeoffid, person: o.person, end: o.end }; });
    var active = Bh.readRows(directives).rows.filter(function (o) { return o.status === "Published" && (!o.start || String(o.start) <= today) && (!o.end || String(o.end) >= today); })
      .map(function (o) { return { id: o.directiveid, title: o.title, end: o.end }; });
    var payload = { away: away, directives: active };
    var sig = JSON.stringify(payload);
    // Silent baseline; later start/end transitions generate one compact event.
    if (!Bh.prop("baseline:hq", "")) { Bh.setProp("baseline:hq", sig); return "baseline"; }
    if (sig === Bh.prop("baseline:hq", "")) return "unchanged";
    Bh.appendEvent({ source: "hq", kind: "date-boundaries", severity: "info", ref: "hq", summary: away.length + " away; " + active.length + " current published directives", payload: payload });
    Bh.setProp("baseline:hq", sig);
    return "notified";
  });
}
