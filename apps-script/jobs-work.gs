/**
 * Job: Work Tracker hygiene (daily 09:00).
 *
 * Reads Tasks + History, computes deterministic problems, and writes ONE
 * compact event to the Agent Inbox. Writes nothing to the tracker itself.
 *
 * Silent when nothing is wrong or nothing changed since the last event.
 * Install with breadInstallTriggers() (install-triggers.gs).
 */

function breadWorkHygiene() {
  return Bh.withLock(function () {
    var ss = SpreadsheetApp.openById(Bh.WORK_SS_ID);
    var sheet = ss.getSheetByName("Tasks");
    if (!sheet) return "no Tasks tab";

    var table = Bh.readRows(sheet);
    var required = ["Task", "Status", "Owner", "Due"];
    for (var i = 0; i < required.length; i++) {
      if (!Bh.col(table.map, required[i])) return "missing column: " + required[i];
    }

    var rows = table.rows.map(function (o) {
      return {
        row: o.__row,
        task: String(o.task || "").trim(),
        project: String(o.project || "").trim(),
        owner: String(o.owner || "").trim(),
        status: String(o.status || "").trim() || "Backlog",
        priority: String(o.priority || "").trim(),
        due: Bh.parseDate(o.due),
        blockedBy: String(o["blocked by"] || "").trim()
      };
    }).filter(function (r) { return r.task; });

    var today = Bh.today();
    var isDone = function (r) { return /^(done|complete|completed|closed)$/i.test(r.status); };
    var inHand = function (r) { return /^(in progress|review|blocked)$/i.test(r.status); };

    /* last history touch per task, for staleness */
    var lastTouch = {};
    var hist = ss.getSheetByName("History");
    if (hist) {
      var ht = Bh.readRows(hist);
      ht.rows.forEach(function (h) {
        var k = String(h.task || "").trim().toLowerCase();
        var d = Bh.parseDate(h.timestamp);
        if (k && d && (!lastTouch[k] || d > lastTouch[k])) lastTouch[k] = d;
      });
    }

    var overdue = [], blocked = [], unowned = [], stale = [], overWip = [];
    var wip = {};

    rows.forEach(function (r) {
      if (isDone(r)) return;

      if (r.due && r.due < today) overdue.push(r);
      if (/^blocked$/i.test(r.status) || r.blockedBy) blocked.push(r);
      if (inHand(r) && !r.owner) unowned.push(r);
      if (/^in progress$/i.test(r.status)) {
        r.owner.split(/&|\+|,| and /i).map(function (s) { return s.trim(); }).filter(Boolean)
          .forEach(function (o) { wip[o] = (wip[o] || 0) + 1; });
      }

      var t = lastTouch[r.task.toLowerCase()];
      if (t && inHand(r) && Bh.daysSince(t) > 21) stale.push({ task: r, days: Bh.daysSince(t) });
    });

    Object.keys(wip).forEach(function (owner) {
      if (wip[owner] > 3) overWip.push({ owner: owner, count: wip[owner] });
    });

    overdue.sort(function (a, b) { return a.due - b.due; });
    stale.sort(function (a, b) { return b.days - a.days; });

    var total = overdue.length + blocked.length + unowned.length + stale.length + overWip.length;
    if (!total) {
      Bh.clear("work", "hygiene");
      return "clear";
    }

    var short = function (r) {
      return "#" + r.row + " " + r.task.slice(0, 60) + (r.owner ? " (" + r.owner + ")" : " (unowned)");
    };
    var payload = {
      counts: {
        overdue: overdue.length, blocked: blocked.length, unowned: unowned.length,
        stale: stale.length, overWip: overWip.length
      },
      overdue: overdue.slice(0, 10).map(function (r) {
        return { row: r.row, task: r.task, owner: r.owner, due: Bh.fmtDate(r.due) };
      }),
      blocked: blocked.slice(0, 10).map(function (r) {
        return { row: r.row, task: r.task, owner: r.owner, why: r.blockedBy || "status Blocked" };
      }),
      unowned: unowned.slice(0, 10).map(function (r) {
        return { row: r.row, task: r.task, status: r.status };
      }),
      stale: stale.slice(0, 10).map(function (x) {
        return { row: x.task.row, task: x.task.task, owner: x.task.owner, days: x.days };
      }),
      overWip: overWip
    };
    var sig = JSON.stringify({ counts: payload.counts, overdue: payload.overdue,
      blocked: payload.blocked, unowned: payload.unowned, overWip: payload.overWip,
      stale: stale.map(function (x) { return [x.task.row, x.task.task, x.task.owner]; }) });

    var summary = Bh.digestLine([
      overdue.length ? overdue.length + " overdue" : "",
      blocked.length ? blocked.length + " blocked" : "",
      unowned.length ? unowned.length + " unowned" : "",
      stale.length ? stale.length + " stale" : "",
      overWip.length ? overWip.length + " over WIP" : ""
    ]);

    var wrote = Bh.notify({
      source: "work",
      kind: "hygiene",
      severity: (overdue.length || blocked.length) ? "action" : "warn",
      ref: "tasks",
      summary: summary,
      payload: payload,
      sig: sig
    });
    return wrote ? "notified: " + summary : "unchanged";
  });
}
