/**
 * Install / run the automation jobs.
 *
 * In the Apps Script editor:
 *   1. Run breadInstallTriggers() once  → daily triggers (script timezone)
 *   2. Run breadRunJobsNow() to smoke-test all three immediately
 *   3. Run breadUninstallTriggers() to remove them
 *
 * The jobs only read sheets and write the Agent Inbox, so a first run is safe.
 */

function breadInstallTriggers() {
  var zone = Session.getScriptTimeZone();
  var jobs = [
    { fn: "breadWorkHygiene", hour: 9, minute: 0 },
    { fn: "breadCrmFollowups", hour: 9, minute: 15 },
    { fn: "breadContributorGate", hour: 9, minute: 30 }
  ];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    jobs.forEach(function (j) {
      if (t.getHandlerFunction() === j.fn) ScriptApp.deleteTrigger(t);
    });
  });
  jobs.forEach(function (j) {
    ScriptApp.newTrigger(j.fn)
      .timeBased()
      .atHour(j.hour)
      .nearMinute(j.minute)
      .everyDays(1)
      .inTimezone(zone)
      .create();
  });
  return "installed " + jobs.length + " daily triggers (" + zone + ")";
}

function breadUninstallTriggers() {
  var names = ["breadWorkHygiene", "breadCrmFollowups", "breadContributorGate"];
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (names.indexOf(t.getHandlerFunction()) >= 0) { ScriptApp.deleteTrigger(t); n++; }
  });
  return "removed " + n;
}

/** Smoke test: run every job once and return their results. */
function breadRunJobsNow() {
  return {
    work: breadWorkHygiene(),
    crm: breadCrmFollowups(),
    contributors: breadContributorGate()
  };
}
