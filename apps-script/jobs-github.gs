/** Hardened replacement for drafts/gh-sync.gs. Default: inbox-only proposals.
 * GITHUB_SYNC_MODE=apply explicitly enables bounded managed-row changes.
 * Never edits human rows, creates email, or interprets remote disappearance as
 * human deletion. GitHub Sync State records only previously managed row keys.
 */
var BreadGithub = (function () {
  var OWNERS = {"diterra-code":"Ruben","bagelface":"bagelface","Olaleye-Blessing":"Blessing","cathschmidt":"Catherine","brendaasfjnso":"Bren","daopunk":"daopunk","dijarllozana":"Dijar","exo404":"exo404","hudsonhrh":"Hudson","tbsoc":"Josh","kassandraoftroy":"Kassandra","lirona":"Liron","elpivote-dev":"Marv","rathermercurial":"rathermercurial.eth","franrolotti":"Francisco","RonTuretzky":"Ron","Mettodo":"Unai","BreadrichEngels":"Breadrich","JustEq4All":"Gilberto"};
  function api(path) {
    var headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    var token = Bh.prop("GITHUB_TOKEN", "");
    if (token) headers.Authorization = "Bearer " + token;
    var response = UrlFetchApp.fetch("https://api.github.com" + path, { headers: headers, muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) throw new Error("GitHub unavailable; no task changes made");
    return JSON.parse(response.getContentText());
  }
  function search(query) {
    var out = [], total;
    for (var page = 1; page <= 5; page++) {
      var r = api("/search/issues?q=" + encodeURIComponent(query) + "&per_page=100&page=" + page);
      if (r.incomplete_results || !Array.isArray(r.items) || r.total_count > 500) throw new Error("GitHub result set incomplete/too large");
      total = r.total_count;
      out = out.concat(r.items);
      if (out.length >= total) return out;
    }
    throw new Error("GitHub pagination incomplete");
  }
  function key(url) {
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, url, Utilities.Charset.UTF_8)
      .map(function (b) { return (b & 255).toString(16).padStart(2, "0"); }).join("").slice(0, 20);
  }
  function desired() {
    var org = Bh.prop("GITHUB_ORG", "BreadchainCoop");
    if (!/^[A-Za-z0-9-]+$/.test(org)) throw new Error("Invalid GitHub org");
    var prs = search("org:" + org + " is:pr is:open");
    var issues = search("org:" + org + " is:issue is:open assignee:*");
    var since = Bh.fmtDate(new Date(Date.now() - 7 * 864e5));
    var closed = search("org:" + org + " is:closed updated:>=" + since);
    if (prs.filter(function (p) { return OWNERS[p.user && p.user.login]; }).length > 40) throw new Error("Too many member PRs; narrow scope");
    var wants = [];
    function add(item, owner, status, suffix, title) {
      var url = item.html_url + (suffix || "");
      if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(pull|issues)\/\d+(#.*)?$/.test(url)) throw new Error("Unexpected GitHub URL");
      var match = String(item.repository_url || "").match(/\/repos\/[^/]+\/([^/]+)$/);
      wants.push({ key: key(url), url: url, base: item.html_url, task: title || item.title, project: match ? match[1] : "", owner: owner, status: status });
    }
    prs.forEach(function (p) {
      var owner = OWNERS[p.user && p.user.login];
      if (!owner) return;
      add(p, owner, p.draft ? "Backlog" : "In progress", "", "PR #" + p.number + ": " + p.title);
      var repo = String(p.repository_url || "").match(/\/repos\/([^/]+\/[^/]+)$/);
      if (!repo) throw new Error("Missing PR repository");
      var reviewers = api("/repos/" + repo[1] + "/pulls/" + p.number + "/requested_reviewers");
      if (!Array.isArray(reviewers.users)) throw new Error("Missing reviewer data");
      reviewers.users.forEach(function (u) { if (OWNERS[u.login] && u.login !== p.user.login) add(p, OWNERS[u.login], "Review", "#review-" + u.login, "Review PR #" + p.number + ": " + p.title); });
    });
    issues.forEach(function (issue) { (issue.assignees || []).forEach(function (a) { if (OWNERS[a.login]) add(issue, OWNERS[a.login], "Backlog", "#" + a.login); }); });
    return { wants: wants, closed: closed.map(function (i) { return i.html_url; }) };
  }
  function run() {
    if (!Bh.WORK_SS_ID) return "not-configured";
    Bh.assertWriteDestination(Bh.WORK_SS_ID);
    var remote = desired(); // full API preflight before task or ledger writes
    return Bh.withLock(function () {
      var ss = SpreadsheetApp.openById(Bh.WORK_SS_ID), sh = ss.getSheetByName("Tasks");
      if (!sh) throw new Error("Missing Tasks");
      var table = Bh.readRows(sh), required = ["task", "project", "owner", "status", "kb link", "notes"];
      required.forEach(function (h) { if (!table.map[h]) throw new Error("Missing Tasks." + h); });
      var managed = {}, existingUrls = {};
      table.rows.forEach(function (o) {
        if (o["kb link"]) existingUrls[String(o["kb link"])] = true;
        var m = String(o.notes || "").match(/^\[gh:([0-9a-f]{20})\]/);
        if (m) { if (managed[m[1]]) throw new Error("Duplicate GitHub task marker"); managed[m[1]] = o; }
      });
      var state = ss.getSheetByName("GitHub Sync State"), ledger = {}, ledgerRows = [];
      if (state) {
        var data = Bh.readRows(state);
        if (!data.map.key || !data.map.url || !data.map.deleted || !data.map.autostatus) throw new Error("Unexpected GitHub state schema");
        data.rows.forEach(function (o) { ledger[String(o.key)] = { url: String(o.url), deleted: String(o.deleted) === "TRUE" || !managed[String(o.key)], autoStatus: String(o.autostatus || "") }; });
      }
      var adds = remote.wants.filter(function (w) { return !managed[w.key] && !existingUrls[w.url] && !(ledger[w.key] && ledger[w.key].deleted); });
      var dones = Object.keys(managed).filter(function (k) {
        var o = managed[k], base = String(o["kb link"] || "").split("#")[0];
        return remote.closed.indexOf(base) >= 0 && ledger[k] && ledger[k].autoStatus === String(o.status) && /^(Backlog|In progress|Review)$/.test(String(o.status));
      });
      var changes = adds.length + dones.length;
      var payload = { add: adds.slice(0, 25), done: dones.slice(0, 25), counts: { add: adds.length, done: dones.length } };
      if (Bh.prop("GITHUB_SYNC_MODE", "inbox") !== "apply") {
        if (!changes) { Bh.clear("github", "sync-proposal"); return "clear"; }
        return Bh.notify({ source: "github", kind: "sync-proposal", severity: "info", ref: "github", summary: adds.length + " GitHub task adds; " + dones.length + " completions proposed (dry run)", payload: payload, sig: JSON.stringify(payload) }) ? "notified" : "unchanged";
      }
      if (changes > 25) throw new Error("GitHub write cap exceeded; review dry-run proposal");
      adds.forEach(function (w) {
        var row = new Array(sh.getLastColumn()).fill("");
        var values = { task: w.task, project: w.project, owner: w.owner, status: w.status, "kb link": w.url, notes: "[gh:" + w.key + "] gh-sync" };
        Object.keys(values).forEach(function (h) { var v = String(values[h]); row[table.map[h] - 1] = v.charAt(0) === "=" ? "'" + v : v; });
        sh.appendRow(row); managed[w.key] = { "kb link": w.url, status: w.status };
      });
      dones.forEach(function (k) { sh.getRange(managed[k].__row, table.map.status).setValue("Done"); ledger[k].autoStatus = "Done"; });
      Object.keys(managed).forEach(function (k) {
        if (!ledger[k]) {
          var desired = remote.wants.filter(function (w) { return w.key === k && w.status === managed[k].status; })[0];
          ledger[k] = { url: String(managed[k]["kb link"] || ""), deleted: false, autoStatus: desired ? desired.status : "" };
        }
      });
      Object.keys(ledger).sort().forEach(function (k) { ledgerRows.push([k, ledger[k].url, ledger[k].deleted ? "TRUE" : "FALSE", ledger[k].autoStatus]); });
      if (ledgerRows.length) {
        if (!state) { state = ss.insertSheet("GitHub Sync State"); state.appendRow(["Key", "URL", "Deleted", "AutoStatus"]); }
        if (state.getMaxRows() < ledgerRows.length + 1) state.insertRowsAfter(state.getMaxRows(), ledgerRows.length + 1 - state.getMaxRows());
        state.getRange(2, 1, ledgerRows.length, 4).setValues(ledgerRows);
      }
      if (changes) Bh.appendEvent({ source: "github", kind: "sync-applied", severity: "info", ref: "github", summary: adds.length + " tasks added; " + dones.length + " completed", payload: payload });
      return changes ? "applied" : "unchanged";
    });
  }
  return { run: run, desired: desired };
}());
function breadGithubSync() { return BreadGithub.run(); }
