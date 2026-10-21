/**
 * Job: Contributor gate (daily 09:30).
 *
 * Replaces the "did anyone new sign up?" prompt with one inbox event:
 *   - genuinely new signups since the last run
 *   - signups that have waited 7+ days with no owner
 *   - the size/age of the waiting backlog
 *
 * First run is a silent baseline. Silent when nothing changed.
 * Install with breadInstallTriggers() (install-triggers.gs).
 */

function breadContributorGate() {
  return Bh.withLock(function () {
    var ss = SpreadsheetApp.openById(Bh.CONTRIB_SS_ID);
    var sheet = Bh.sheetByRegex(ss, /^new form responses/i);
    if (!sheet) return "no live form tab";

    var table = Bh.readRows(sheet);
    var pick = function (o, keys) {
      for (var i = 0; i < keys.length; i++) if (o[keys[i]] !== undefined) return o[keys[i]];
      return "";
    };
    var str = function (v) { return String(v === null || v === undefined ? "" : v).trim(); };

    var people = table.rows.map(function (o) {
      return {
        row: o.__row,
        name: str(o["what is your name?"]),
        ts: Bh.parseDate(o.timestamp),
        status: str(o.status),
        owner: str(pick(o, ["contact perons in bc core", "contact person in bc core", "contact person"])),
        pref: str(o["what is your preferred method of contact?"]),
        email: str(o["what is your email?"]),
        discord: str(o["what is your discord handle?"])
      };
    }).filter(function (p) { return p.name && p.ts; });

    if (!people.length) {
      if (!Bh.prop("cursor:contributors", "")) Bh.setProp("cursor:contributors", "1970-01-01T00:00:00.000Z");
      return "no signups";
    }

    var channel = function (p) {
      var s = p.pref.toLowerCase();
      if (/discord/.test(s)) return "Discord";
      if (/telegram|t\.me/.test(s)) return "Telegram";
      if (/signal/.test(s)) return "Signal";
      if (/phone|sms|whats/.test(s)) return "Phone";
      if (/e-?mail/.test(s) || p.email) return "Email";
      return "unknown";
    };
    var on = function (p) { return Bh.fmtDate(p.ts); };
    var days = function (p) { return Bh.daysSince(p.ts); };

    var maxTs = people.reduce(function (m, p) { return p.ts > m ? p.ts : m; }, people[0].ts);
    var cursorRaw = Bh.prop("cursor:contributors", "");
    var isBaseline = !cursorRaw;
    var cursor = cursorRaw ? new Date(cursorRaw) : null;

    var fresh = isBaseline ? [] : people.filter(function (p) { return p.ts > cursor; });
    var waiting = people.filter(function (p) { return !p.status; });
    var staleUnowned = waiting.filter(function (p) { return !p.owner && days(p) >= 7; });
    var old = waiting.filter(function (p) { return days(p) > 30; });
    var oldest = waiting.reduce(function (n, p) { return Math.max(n, days(p)); }, 0);

    if (isBaseline) {
      Bh.setProp("cursor:contributors", maxTs.toISOString());
      Bh.clear("contributors", "gate");
      return "baseline: " + people.length;
    }

    if (!fresh.length && !staleUnowned.length && !old.length) {
      Bh.clear("contributors", "gate");
      Bh.setProp("cursor:contributors", maxTs.toISOString());
      return "clear";
    }

    var payload = {
      counts: {
        new: fresh.length, waiting: waiting.length,
        noOwner7d: staleUnowned.length, waiting30d: old.length, oldestDays: oldest
      },
      new: fresh.slice(0, 10).map(function (p) {
        return { name: p.name, on: on(p), channel: channel(p) };
      }),
      noOwner7d: staleUnowned.slice(0, 10).map(function (p) {
        return { name: p.name, on: on(p), days: days(p), channel: channel(p) };
      }),
      waiting30d: old.slice(0, 10).map(function (p) {
        return { name: p.name, on: on(p), days: days(p), owner: p.owner };
      })
    };
    var summary = Bh.digestLine([
      fresh.length ? fresh.length + " new signup" + (fresh.length === 1 ? "" : "s") : "",
      waiting.length ? waiting.length + " waiting" : "",
      staleUnowned.length ? staleUnowned.length + " with no owner 7d+" : "",
      old.length ? old.length + " waiting 30d+" : ""
    ]);

    var sig = JSON.stringify({
      latest: maxTs.toISOString(),
      waiting: waiting.map(function (p) { return p.name + "|" + p.ts.toISOString(); }),
      noOwner7d: staleUnowned.map(function (p) { return p.name + "|" + on(p); }),
      waiting30d: old.map(function (p) { return p.name + "|" + on(p); })
    });

    var wrote = Bh.notify({
      source: "contributors",
      kind: "gate",
      severity: (fresh.length || old.length) ? "action" : "warn",
      ref: "signups",
      summary: summary,
      payload: payload,
      sig: sig
    });
    Bh.setProp("cursor:contributors", maxTs.toISOString());
    return wrote ? "notified: " + summary : "unchanged";
  });
}
