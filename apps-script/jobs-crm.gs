/**
 * Job: CRM follow-ups (daily 09:15).
 *
 * Reads the CRM feed's Contacts tab (no coordinates — names, status, owner,
 * last-connected only) and writes ONE compact event:
 *   - Contacted but silent 45+ days
 *   - High/Immediate priority with no owner
 *   - Blocked
 *
 * Flag-only: never changes status or owner. Silent when nothing changed.
 * Install with breadInstallTriggers() (install-triggers.gs).
 */

function breadCrmFollowups() {
  return Bh.withLock(function () {
    var ss = SpreadsheetApp.openById(Bh.CRM_FEED_ID);
    var sheet = Bh.sheetById(ss, Bh.CRM_GID_CONTACTS);
    if (!sheet) return "no Contacts tab in CRM feed";

    var table = Bh.readRows(sheet);
    var archived = {};
    var campaignSheet = ss.getSheetByName("Campaigns");
    if (campaignSheet) Bh.readRows(campaignSheet).rows.forEach(function (o) {
      if (String(o.status) === "Archived") archived[String(o.campaignid)] = true;
    });
    var str = function (v) { return String(v === null || v === undefined ? "" : v).trim(); };
    var rows = table.rows.map(function (o) {
      return {
        campaign: str(o.campaign),
        campaignId: str(o.campaignid), contactId: str(o.contactid),
        contact: str(o.contact),
        priority: str(o.priority),
        goal: str(o.goal),
        owner: str(o.owner),
        status: str(o.status),
        action: str(o.action),
        last: o.contactid && !/^\d{4}-\d{2}-\d{2}$/.test(str(o.lastconnected)) ? null : Bh.parseDate(o.lastconnected),
        row: str(o.row),
        gid: str(o.gid)
      };
    }).filter(function (r) { return r.contact && !archived[r.campaignId] && (r.contactId || r.contact.charAt(0) !== "#"); });

    var closed = function (r) { return /^(completed|declined)$/i.test(r.status); };
    var contacted = function (r) { return /^contacted$/i.test(r.status); };
    var high = function (r) { return /^(immediate|high)$/i.test(r.priority); };

    var stale = [], unownedHigh = [], blocked = [], noDate = 0;

    rows.forEach(function (r) {
      if (closed(r)) return;
      if (contacted(r)) {
        if (!r.last) noDate++;
        else if (Bh.daysSince(r.last) > 45) stale.push({ r: r, days: Bh.daysSince(r.last) });
      }
      if (high(r) && !r.owner) unownedHigh.push(r);
      if (/^blocked$/i.test(r.status)) blocked.push(r);
    });

    stale.sort(function (a, b) { return b.days - a.days; });

    var total = stale.length + unownedHigh.length + blocked.length;
    if (!total) {
      Bh.clear("crm", "followups");
      return "clear";
    }

    var brief = function (r) {
      return {
        campaign: r.campaign, contact: r.contact, owner: r.owner,
        priority: r.priority, status: r.status, action: r.action,
        row: r.row, gid: r.gid, contactId: r.contactId
      };
    };
    var payload = {
      counts: {
        stale45: stale.length, noDate: noDate,
        unownedHigh: unownedHigh.length, blocked: blocked.length
      },
      stale45: stale.slice(0, 8).map(function (x) {
        var o = brief(x.r); o.days = x.days; return o;
      }),
      unownedHigh: unownedHigh.slice(0, 8).map(brief),
      blocked: blocked.slice(0, 8).map(brief),
      noDate: noDate
    };
    var summary = Bh.digestLine([
      stale.length ? stale.length + " silent 45d+" : "",
      noDate ? noDate + " contacted, no date" : "",
      unownedHigh.length ? unownedHigh.length + " high-priority unowned" : "",
      blocked.length ? blocked.length + " blocked" : ""
    ]);

    var wrote = Bh.notify({
      source: "crm",
      kind: "followups",
      severity: (stale.length || unownedHigh.length) ? "action" : "warn",
      ref: "contacts",
      summary: summary,
      payload: payload,
      sig: JSON.stringify({ counts: payload.counts, unownedHigh: payload.unownedHigh,
        blocked: payload.blocked, stale: stale.map(function (x) { return [x.r.contactId || x.r.campaign + "|" + x.r.row, x.r.owner, x.r.action]; }) })
    });
    return wrote ? "notified: " + summary : "unchanged";
  });
}
