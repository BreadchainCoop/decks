/** Grants gates replace draft email jobs. Inbox-only by default; no external
 * submission, email or model call. Explicit GRANTS_INTAKE_MODE=apply permits
 * bounded intake + internal draft-doc creation after exact matching.
 */
var BreadGrantJobs = (function () {
  function tracker() {
    var id = Bh.prop("GRANTS_SPREADSHEET_ID", "");
    return id ? SpreadsheetApp.openById(id) : null;
  }
  function hash(value) {
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8).map(function (b) { return (b & 255).toString(16).padStart(2, "0"); }).join("");
  }
  function grantTable(sh) {
    var t = Bh.readRows(sh);
    if (!t.map.funder && t.map["organizational name"]) t.map.funder = t.map["organizational name"];
    t.rows.forEach(function (o) {
      if (o.funder === undefined) o.funder = o["organizational name"];
      if (o.grant === undefined) o.grant = o["grant name"];
    });
    return t;
  }
  function intakeTable(sh) {
    var headRow = 0, n = Math.min(sh.getLastRow(), 20);
    if (!n) throw new Error("Empty intake sheet");
    sh.getRange(1, 1, n, sh.getLastColumn()).getDisplayValues().some(function (row, i) {
      if (row.some(function (h) { return String(h).trim().toLowerCase() === "funder"; })) { headRow = i + 1; return true; }
      return false;
    });
    if (!headRow) throw new Error("No Funder header in intake");
    var t = Bh.readRows(sh, headRow);
    t.rows.forEach(function (o) {
      if (o.grant === undefined) o.grant = o["grant / program (optional)"];
      // Existing Breadrich completions must NEVER be re-intaken merely because
      // the new script's own Handled column has not been created yet.
      if (!o.handled && o["status (breadrich fills this)"]) o.handled = o["status (breadrich fills this)"];
    });
    return t;
  }
  function intake() {
    var ss = tracker(); if (!ss) return "not-configured";
    return Bh.withLock(function () {
      var form = ss.getSheetByName("Start a Grant"), grants = ss.getSheetByName("Grants");
      if (!form || !grants) return "missing intake/Grants tab";
      var requests = intakeTable(form), targets = grantTable(grants);
      if (!requests.map.funder || !targets.map.funder) throw new Error("Intake and Grants require exact Funder headers");
      var pending = requests.rows.filter(function (o) { return String(o.funder || "").trim() && !o.handled; });
      if (!pending.length) { Bh.clear("grants", "intake"); return "clear"; }
      var payload = { count: pending.length, rows: pending.slice(0, 10).map(function (o) { return { row: o.__row, funder: String(o.funder), grant: String(o.grant || "") }; }) };
      if (Bh.prop("GRANTS_INTAKE_MODE", "inbox") !== "apply") return Bh.notify({ source: "grants", kind: "intake", severity: "action", ref: "intake", summary: pending.length + " grant intake requests (dry run)", payload: payload, sig: JSON.stringify(payload) }) ? "notified" : "unchanged";
      Bh.assertWriteDestination(ss.getId());
      if (pending.length > 10) throw new Error("Grant intake cap exceeded; review requests first");
      ["pipeline stage", "team member", "next action", "next action date", "document link"].forEach(function (h) { if (!targets.map[h]) throw new Error("Missing Grants." + h); });
      // Validate ALL exact matches before creating documents or changing rows.
      var plannedTargets = {};
      var plans = pending.map(function (o) {
        var matches = targets.rows.filter(function (g) { return String(g.funder || "").trim().toLowerCase() === String(o.funder).trim().toLowerCase() && (!o.grant || String(g.grant || "").trim().toLowerCase() === String(o.grant).trim().toLowerCase()); });
        if (matches.length !== 1) throw new Error("Intake funder/grant missing or ambiguous at row " + o.__row);
        var target = matches[0];
        if (plannedTargets[target.__row]) throw new Error("Multiple pending requests target the same grant; reconcile first");
        plannedTargets[target.__row] = true;
        if (["Sourced", "Qualified", "Asset-ready", "Drafting", "Internal review", ""].indexOf(String(target["pipeline stage"] || "")) < 0) throw new Error("Intake would reset a submitted/finished grant; review manually");
        if (target["document link"] && !/^https:\/\/docs\.google\.com\/document\/d\//.test(String(target["document link"]))) throw new Error("Existing document link needs review");
        return { request: o, target: target };
      });
      var fm = Bh.headerMap(form, ["Intake ID", "Document ID", "Handled"], true, requests.headerRow), done = 0;
      plans.forEach(function (plan) {
        var o = plan.request, g = plan.target;
        var id = String(o["intake id"] || "");
        if (!id) { id = Utilities.getUuid(); form.getRange(o.__row, fm["intake id"]).setValue(id); SpreadsheetApp.flush(); }
        var link = String(g["document link"] || ""), documentId = String(o["document id"] || "");
        if (!link) {
          var title = "Grant — " + String(o.funder) + " [intake:" + id + "]";
          if (!documentId) {
            // Recover a doc made just before a prior execution failed, rather
            // than create another orphan on retry.
            var files = DriveApp.getFilesByName(title), found = [];
            while (files.hasNext()) found.push(files.next().getId());
            if (found.length > 1) throw new Error("Duplicate intake docs; reconcile manually");
            if (found.length) documentId = found[0];
            else {
              var doc = DocumentApp.create(title), body = doc.getBody();
              body.appendParagraph("GRANT REQUIREMENTS — paste the call outline and questions here");
              ["Summary", "Fit", "Project", "Budget — verified numbers only", "Team", "Impact", "Risks"].forEach(function (h) { body.appendParagraph(h).setHeading(DocumentApp.ParagraphHeading.HEADING2); body.appendParagraph(""); });
              doc.saveAndClose(); documentId = doc.getId();
            }
            form.getRange(o.__row, fm["document id"]).setValue(documentId); SpreadsheetApp.flush();
          }
          link = "https://docs.google.com/document/d/" + documentId + "/edit";
        }
        grants.getRange(g.__row, targets.map["document link"]).setValue(link);
        grants.getRange(g.__row, targets.map["pipeline stage"]).setValue("Drafting");
        var owner = String(o["team member"] || o.owner || o["your name"] || "");
        if (owner) grants.getRange(g.__row, targets.map["team member"]).setValue(owner.charAt(0) === "=" ? "'" + owner : owner);
        grants.getRange(g.__row, targets.map["next action"]).setValue("Review the call requirements and prepare the draft; a human submits");
        grants.getRange(g.__row, targets.map["next action date"]).setValue(Bh.fmtDate(Bh.today()));
        form.getRange(o.__row, fm.handled).setValue("Applied " + new Date().toISOString()); done++;
      });
      Bh.appendEvent({ source: "grants", kind: "intake-applied", severity: "info", ref: "intake", summary: done + " grant drafts prepared", payload: payload });
      return "applied: " + done;
    });
  }
  function hygiene() {
    var ss = tracker(); if (!ss) return "not-configured";
    return Bh.withLock(function () {
      var sh = ss.getSheetByName("Grants") || ss.getSheetByName("Targets");
      if (!sh) return "missing grants tab";
      var today = Bh.fmtDate(Bh.today()), flags = [], requests = 0;
      var rows = grantTable(sh).rows.filter(function (o) { return o.funder && !/^(Outcome|Archived)$/i.test(String(o["pipeline stage"] || "")); });
      var urls = [], seen = {};
      rows.forEach(function (o) { ["document link", "website"].forEach(function (h) { var u = String(o[h] || ""); if (/^https?:\/\//i.test(u) && !seen[u]) { seen[u] = true; urls.push(u); } }); });
      var start = urls.length ? Number(Bh.prop("grants:link-offset", "0")) % urls.length : 0;
      for (var index = 0; index < Math.min(20, urls.length); index++) {
        var url = urls[(start + index) % urls.length], key = "grant-link:" + hash(url).slice(0, 24);
        requests++;
        try {
          var response = UrlFetchApp.fetch(url, { method: "get", muteHttpExceptions: true, followRedirects: true });
          var code = response.getResponseCode();
          if (code === 404 || code === 410) Bh.setProp(key, "dead");
          else if (code >= 200 && code < 400) Bh.delProp(key);
          // 403/429/network failures neither prove death nor clear a prior 404.
        } catch (e) { /* preserve last confirmed status */ }
      }
      if (urls.length) Bh.setProp("grants:link-offset", (start + requests) % urls.length);
      rows.forEach(function (o) {
        var reasons = [], due = Bh.parseDate(o["next action date"]);
        if (due && Bh.fmtDate(due) < today) reasons.push("next action overdue");
        ["document link", "website"].forEach(function (h) {
          var url = String(o[h] || "");
          if (/^https?:\/\//i.test(url) && Bh.prop("grant-link:" + hash(url).slice(0, 24), "") === "dead") reasons.push(h + " unavailable (last confirmed 404/410)");
        });
        if (reasons.length) flags.push({ row: o.__row, funder: String(o.funder), reasons: reasons });
      });
      if (!flags.length) { Bh.clear("grants", "hygiene"); return "clear"; }
      var payload = { count: flags.length, flags: flags.slice(0, 20), linkChecks: requests };
      return Bh.notify({ source: "grants", kind: "hygiene", severity: "action", ref: "grants", summary: flags.length + " grant rows need review (flag only)", payload: payload, sig: JSON.stringify(flags) }) ? "notified" : "unchanged";
    });
  }
  function discovery() {
    var sources = ["https://blog.ethereum.org/feed.xml", "https://nlnet.nl/news/", "https://www.opentech.fund/news/", "https://cordis.europa.eu/news", "https://neb.eitcommunity.eu/", "https://challengeworks.org/news/", "https://leverforchange.org/our-network/", "https://floss.fund/"];
    if (!Bh.WORK_SS_ID) return "not-configured";
    return Bh.withLock(function () {
      var changed = [], initial = 0;
      sources.forEach(function (url, i) {
        try {
          var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
          if (response.getResponseCode() !== 200) return;
          var text = response.getContentText();
          if (text.length > 1000000) return; // bounded parser; retain prior cursor
          // For RSS, only titles/links; for pages ignore tags, scripts, styles
          // and whitespace. This is a change gate, not a fit classifier.
          var items = text.match(/<(item|entry)[\s\S]*?<\/(item|entry)>/gi);
          var clean = items ? items.map(function (b) { return ((b.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "") + "|" + ((b.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1] || (b.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || ""); }).sort().join("|") : text.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
          var signature = hash(clean);
          var key = "discovery:" + i, previous = Bh.prop(key, "");
          if (previous && previous !== signature) changed.push({ url: url, signature: signature });
          if (!previous) { Bh.setProp(key, signature); initial++; }
        } catch (e) { /* failed source never clears its baseline */ }
      });
      if (!changed.length) return initial ? "baseline" : "unchanged";
      var ss = tracker();
      if (ss) {
        Bh.assertWriteDestination(ss.getId());
        var queue = ss.getSheetByName("Discovery Inbox"), headers = ["Timestamp", "Source", "Signature", "Status"];
        if (!queue) { queue = ss.insertSheet("Discovery Inbox"); queue.appendRow(headers); }
        var q = Bh.readRows(queue);
        if (!q.map.source || !q.map.signature || !q.map.status) throw new Error("Unexpected Discovery Inbox schema");
        changed.forEach(function (entry) {
          if (!q.rows.some(function (o) { return o.source === entry.url && o.signature === entry.signature; })) queue.appendRow([new Date().toISOString(), entry.url, entry.signature, "Needs review"]);
        });
      }
      Bh.notify({ source: "grants", kind: "discovery-changed", severity: "info", ref: "discovery", summary: changed.length + " funding sources changed; review fit before adding", payload: { sources: changed.map(function (o) { return o.url; }) }, sig: JSON.stringify(changed) });
      changed.forEach(function (entry) { Bh.setProp("discovery:" + sources.indexOf(entry.url), entry.signature); });
      return "notified";
    });
  }
  return { intake: intake, hygiene: hygiene, discovery: discovery };
}());
function breadGrantIntake() {
  var result = BreadGrantJobs.intake();
  if (/^applied/.test(String(result)) && Bh.prop("GRANTS_FEED_ID", "")) {
    try { if (!BreadGrantsFeed.refresh()) return result + "; feed refresh pending"; }
    catch (e) { return result + "; feed refresh pending"; }
  }
  return result;
}
function breadGrantHygiene() { return BreadGrantJobs.hygiene(); }
function breadGrantDiscovery() { return BreadGrantJobs.discovery(); }
