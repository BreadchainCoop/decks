/** Explicit trigger installation. Never called by a web request or build.
 * Uses only configured sheets. Old live jobs/watchers are NOT removed here.
 */
var BREAD_SUITE_TRIGGERS = ["breadWorkHygiene", "breadCrmFollowups", "breadContributorGate", "breadContributorFormSubmit", "breadWeeklyRollup", "breadHqBoundaries", "breadGithubSync", "breadGrantIntake", "breadGrantHygiene", "breadGrantDiscovery"];
function breadUninstallSuiteTriggers() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (BREAD_SUITE_TRIGGERS.indexOf(t.getHandlerFunction()) >= 0) { ScriptApp.deleteTrigger(t); removed++; }
  });
  return { removed: removed };
}
function breadInstallSuiteTriggers() {
  if (!Bh.WORK_SS_ID) throw new Error("Configure WORK_SPREADSHEET_ID for the Agent Inbox first");
  var jobs = [{ fn: "breadWeeklyRollup", hour: 8, minute: 0, weekly: true }];
  if (Bh.WORK_SS_ID) jobs.push({ fn: "breadWorkHygiene", hour: 9, minute: 0 });
  if (Bh.CRM_FEED_ID) jobs.push({ fn: "breadCrmFollowups", hour: 9, minute: 15 });
  if (Bh.CONTRIB_SS_ID) {
    // Avoid treating the historical form backlog as fresh form submissions.
    breadContributorGate();
    jobs.push({ fn: "breadContributorGate", hour: 9, minute: 30 });
  }
  if (Bh.prop("HQ_SPREADSHEET_ID", "")) { breadHqBoundaries(); jobs.push({ fn: "breadHqBoundaries", hour: 8, minute: 10 }); }
  if (Bh.prop("GITHUB_SYNC_ENABLED", "") === "true") jobs.push({ fn: "breadGithubSync", hourly: true });
  if (Bh.prop("GRANTS_SPREADSHEET_ID", "")) {
    jobs.push({ fn: "breadGrantIntake", hour: 8, minute: 45 });
    jobs.push({ fn: "breadGrantHygiene", hour: 8, minute: 15, weekly: true });
    jobs.push({ fn: "breadGrantDiscovery", hour: 8, minute: 25, weekly: true, wednesday: true });
  }
  breadUninstallSuiteTriggers();
  var zone = Session.getScriptTimeZone();
  jobs.forEach(function (j) {
    var builder = ScriptApp.newTrigger(j.fn).timeBased();
    if (j.hourly) builder.everyHours(1).create();
    else {
      builder.atHour(j.hour).nearMinute(j.minute).inTimezone(zone);
      if (j.weekly) builder.onWeekDay(j.wednesday ? ScriptApp.WeekDay.WEDNESDAY : ScriptApp.WeekDay.MONDAY).everyWeeks(1);
      else builder.everyDays(1);
      builder.create();
    }
  });
  if (Bh.CONTRIB_SS_ID) ScriptApp.newTrigger("breadContributorFormSubmit").forSpreadsheet(Bh.CONTRIB_SS_ID).onFormSubmit().create();
  return { installed: jobs.map(function (j) { return j.fn; }).concat(Bh.CONTRIB_SS_ID ? ["breadContributorFormSubmit"] : []), timezone: zone };
}
function breadSuiteTriggerAudit() {
  return ScriptApp.getProjectTriggers().map(function (t) { return { handler: t.getHandlerFunction(), eventType: String(t.getEventType()), source: String(t.getTriggerSource()), id: t.getUniqueId() }; });
}

/** Read-only configuration/schema preflight. It cannot prove edit permission;
 * the staging smoke test must exercise a scratch write in each domain. */
function breadSuitePreflight() {
  var result = { environment: Bh.prop("BREAD_ENVIRONMENT", "staging"), ok: true, sheets: {}, errors: [] };
  var keys = ["WORK_SPREADSHEET_ID", "CONTRIB_SPREADSHEET_ID", "CRM_SPREADSHEET_ID", "CRM_FEED_ID", "GRANTS_SPREADSHEET_ID", "GRANTS_FEED_ID", "HQ_SPREADSHEET_ID"];
  var required = { WORK_SPREADSHEET_ID: ["Tasks"], CRM_SPREADSHEET_ID: ["Contacts", "Campaigns", "History", "Links"], CRM_FEED_ID: ["Contacts", "Campaigns", "History", "Links"], GRANTS_SPREADSHEET_ID: ["Grants"], GRANTS_FEED_ID: ["Targets", "Stats"], HQ_SPREADSHEET_ID: ["Resources", "Directives", "TimeOff", "History"] };
  var seen = {};
  keys.forEach(function (key) {
    var id = Bh.prop(key, "");
    if (!id) { result.errors.push(key + " is not configured"); return; }
    if (seen[id]) result.errors.push(key + " shares a destination with " + seen[id]);
    seen[id] = key;
    try {
      Bh.assertWriteDestination(id);
      var ss = SpreadsheetApp.openById(id), missing = (required[key] || []).filter(function (name) { return !ss.getSheetByName(name); });
      if (key === "CONTRIB_SPREADSHEET_ID" && !Bh.sheetByRegex(ss, /^new form responses/i)) missing.push("New Form Responses…");
      result.sheets[key] = { id: id, readable: true, missingTabs: missing };
      if (missing.length) result.errors.push(key + " missing tabs: " + missing.join(", "));
    } catch (e) { result.sheets[key] = { id: id, readable: false }; result.errors.push(key + " cannot be used in this environment"); }
  });
  if (Bh.prop("BREAD_WRITE_TOKEN", "").length < 32) result.errors.push("Member token must be at least 32 characters");
  var committee = Bh.prop("HQ_COMMITTEE_TOKEN", "");
  if (committee.length < 32 || committee === Bh.prop("BREAD_WRITE_TOKEN", "")) result.errors.push("A separate 32+ character committee token is required");
  result.ok = !result.errors.length;
  return result;
}

/** Uses configured sheets only. Default modes are inbox-only; explicitly
 * configured apply modes are honored, so use staging copies for rehearsal. */
function breadRunSuiteJobsNow() {
  var jobs = ["breadWorkHygiene", "breadCrmFollowups", "breadContributorGate", "breadWeeklyRollup", "breadHqBoundaries", "breadGrantIntake", "breadGrantHygiene", "breadGrantDiscovery"];
  if (Bh.prop("GITHUB_SYNC_ENABLED", "") === "true") jobs.push("breadGithubSync");
  var functions = { breadWorkHygiene: breadWorkHygiene, breadCrmFollowups: breadCrmFollowups, breadContributorGate: breadContributorGate, breadWeeklyRollup: breadWeeklyRollup, breadHqBoundaries: breadHqBoundaries, breadGrantIntake: breadGrantIntake, breadGrantHygiene: breadGrantHygiene, breadGrantDiscovery: breadGrantDiscovery, breadGithubSync: breadGithubSync };
  var result = {};
  jobs.forEach(function (name) {
    try { result[name] = functions[name](); }
    catch (e) { result[name] = "failed — inspect configuration/schema and execution log"; console.error(name + " failed: " + (e.message || "unknown")); }
  });
  return result;
}
