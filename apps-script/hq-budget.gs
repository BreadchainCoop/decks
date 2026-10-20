/** Read-only, aggregate-only budget scenario adapter. Never reads member rows.
 * Override HQ_BUDGET_SPREADSHEET_ID / HQ_BUDGET_GID in Script Properties.
 * A changed layout fails closed, rather than showing an unrelated cell as cash.
 */
var BreadBudget = (function () {
  function read() {
    try {
      var p = PropertiesService.getScriptProperties();
      var id = p.getProperty("HQ_BUDGET_SPREADSHEET_ID") || "1iWZXv2yaquz_oRlYGCn0jhJYsVuseea6e0aE2EpYsx8";
      var gid = p.getProperty("HQ_BUDGET_GID") || "1139000984";
      var sheets = SpreadsheetApp.openById(id).getSheets(), sh = null;
      sheets.forEach(function (s) { if (String(s.getSheetId()) === String(gid)) sh = s; });
      if (!sh) return null;
      var rows = sh.getRange(1, 1, 10, 2).getDisplayValues();
      if (rows[0][0] !== "Breadchain Runway Calculator" || !rows[1][0]) return null;
      function field(label) {
        var found = rows.filter(function (r) { return r[0] === label; });
        if (found.length !== 1 || !found[0][1]) throw new Error("Budget layout changed");
        return found[0][1];
      }
      return { ok: true, period: rows[1][0], treasury: field("Treasury"),
        outstandingIncome: field("Outstanding Income"), runway: field("Runway"),
        readAt: new Date().toISOString(), sourceId: id, gid: String(gid) };
    } catch (e) { return null; }
  }
  return { read: read };
}());
