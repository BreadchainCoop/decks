/**
 * Bread Work Tracker — GitHub → Tasks sync (Apps Script port of work/gh-sync/sync.cjs)
 *
 * Paste into the Work Tracker sheet's Apps Script project (same project as
 * work-tracker-write.gs), then run installGhSyncTrigger() once.
 *
 * What it does every hour (no LLM, no bot involved):
 *   1. Reads open member PRs (+ review requests) and assigned member issues
 *      from the BreadchainCoop org via the GitHub REST search API.
 *   2. Diffs against the Tasks tab (columns found by header name).
 *   3. Appends new rows (Notes = "gh-sync"), auto-Dones rows whose PR/issue
 *      closed/merged in the last 7 days, honors tombstones (human deletions
 *      are permanent), never touches human status edits except auto-Done.
 *   4. Appends one summary row to History.
 *
 * Properties (Script Properties, all optional):
 *   GITHUB_TOKEN  — PAT for headroom (public repos work without it, but the
 *                   unauthenticated core limit is 60 req/hour).
 *   NOTIFY_EMAIL  — gets a manual summary email when the run did something
 *                   (default: nobody — the sheet + History are the record).
 *
 * daopunk rows sync owner-name-only (standing rule).
 */

var GHSYNC_ORG = 'BreadchainCoop';
var GHSYNC_OWNERS = {
  'diterra-code': 'Ruben', 'bagelface': 'bagelface', 'Olaleye-Blessing': 'blessing',
  'cathschmidt': 'catherine', 'brendaasfjnso': 'Bren', 'daopunk': 'daopunk',
  'dijarllozana': 'dijar', 'exo404': 'exo404', 'hudsonhrh': 'hudsonhrh',
  'tbsoc': 'Josh', 'kassandraoftroy': 'Kassandra', 'lirona': 'Liron',
  'elpivote-dev': 'Marv', 'rathermercurial': 'RatherMercurial',
  'franrolotti': 'Francisco', 'RonTuretzky': 'Ron', 'Mettodo': 'Unai',
  'BreadrichEngels': 'Breadrich', 'JustEq4All': 'Gilberto'
};

function ghSyncProp_(key, dflt) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return (v === null || v === '') ? dflt : v;
}

function ghApi_(path) {
  var opts = { muteHttpExceptions: true, headers: { Accept: 'application/vnd.github+json' } };
  var token = ghSyncProp_('GITHUB_TOKEN', '');
  if (token) opts.headers.Authorization = 'Bearer ' + token;
  var res = UrlFetchApp.fetch('https://api.github.com' + path, opts);
  if (res.getResponseCode() !== 200) throw new Error('GitHub ' + path + ' → ' + res.getResponseCode());
  return JSON.parse(res.getContentText());
}

function ghSearch_(q) {
  return (ghApi_('/search/issues?q=' + encodeURIComponent(q) + '&per_page=100').items || []);
}
function repoName_(item) {
  // repository_url = https://api.github.com/repos/<org>/<repo>
  var m = String(item.repository_url || '').match(/\/repos\/[^/]+\/([^/]+)$/);
  return m ? m[1] : '';
}
var isBotLogin_ = function (l) { return !l || /bot\]?$/.test(l) || /^(copilot|dependabot|renovate)/i.test(l); };

function ghSyncHourly() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var props = PropertiesService.getScriptProperties();
    var state = JSON.parse(props.getProperty('GHSYNC_STATE') || '{"tombstones":[]}');

    /* ── 1. GitHub state ── */
    var org = GHSYNC_ORG;
    var prs = ghSearch_('org:' + org + ' is:pr is:open').filter(function (p) {
      return p.draft === undefined || true; // draft kept, just flagged below
    }).filter(function (p) { return p.user && !isBotLogin_(p.user.login); });
    var issues = ghSearch_('org:' + org + ' is:issue is:open assignee:*');
    var since = Utilities.formatDate(new Date(Date.now() - 7 * 864e5), 'UTC', 'yyyy-MM-dd');
    var mergedUrls = ghSearch_('org:' + org + ' is:pr is:merged updated:>=' + since)
      .map(function (p) { return p.html_url; });

    var ownerOf = function (l) { return (l && GHSYNC_OWNERS[l]) || l || ''; };
    var isMember = function (l) { return !!GHSYNC_OWNERS[l]; };

    /* desired rows: open member PR, per review request, per assigned member issue */
    var want = [];
    prs.forEach(function (p) {
      if (!isMember(p.user.login)) return;
      var proj = repoName_(p);
      want.push({ url: p.html_url, task: 'PR #' + p.number + ': ' + p.title, project: proj,
        owner: ownerOf(p.user.login), status: p.draft ? 'Backlog' : 'In progress' });
      if (p.pull_request && p.pull_request.url) {
        var reqs;
        try { reqs = ghApi_('/repos/' + org + '/' + proj + '/pulls/' + p.number + '/requested_reviewers'); }
        catch (e) { reqs = { users: [] }; }
        (reqs.users || []).forEach(function (u) {
          if (isBotLogin_(u.login) || u.login === p.user.login || !isMember(u.login)) return;
          want.push({ url: p.html_url + '#review-' + u.login,
            task: 'Review PR #' + p.number + ': ' + p.title, project: proj,
            owner: ownerOf(u.login), status: 'Review' });
        });
      }
    });
    issues.forEach(function (i) {
      (i.assignees || []).forEach(function (a) {
        if (isBotLogin_(a.login) || !isMember(a.login)) return;
        want.push({ url: i.html_url + '#' + a.login, task: i.title, project: repoName_(i),
          owner: ownerOf(a.login), status: 'Backlog' });
      });
    });

    /* ── 2. Current sheet rows (direct read — bound to this sheet) ── */
    var ss = SpreadsheetApp.getActive();
    var tasks = ss.getSheetByName('Tasks');
    var hist = ss.getSheetByName('History');
    var head = tasks.getRange(1, 1, 1, tasks.getLastColumn()).getValues()[0]
      .map(function (h) { return String(h).toLowerCase().trim(); });
    var taskC = head.indexOf('task'), statusC = head.indexOf('status'), linkC = head.indexOf('kb link');
    if (taskC < 0 || statusC < 0 || linkC < 0) throw new Error('Tasks header row missing task/status/kb link');
    var lastRow = tasks.getLastRow();
    var rows = lastRow > 1 ? tasks.getRange(2, 1, lastRow - 1, tasks.getLastColumn()).getValues() : [];
    var byUrl = {}, bareUrls = {};
    rows.forEach(function (r, idx) {
      var url = String(r[linkC] || '').trim();
      if (!/^https:\/\/github\.com\//.test(url)) return;
      var rowNum = idx + 2;
      byUrl[url] = { row: rowNum, task: String(r[taskC] || ''), status: String(r[statusC] || '') };
      bareUrls[url.split('#')[0]] = true;
    });

    /* ── 3. Diff → writes ── */
    var adds = [], dones = 0, tombstoned = 0;
    want.forEach(function (w) {
      if (state.tombstones.indexOf(w.url) >= 0) { tombstoned++; return; }
      if (byUrl[w.url] || bareUrls[w.url.split('#')[0]]) return;
      adds.push([w.task, w.project, w.owner, w.status, '', '', '', '', w.url, 'gh-sync']);
    });
    Object.keys(byUrl).forEach(function (u) {
      var r = byUrl[u];
      if (r.status === 'Done') return;
      if (mergedUrls.indexOf(u.split('#')[0]) >= 0) {
        tasks.getRange(r.row, statusC + 1).setValue('Done');
        dones++;
      }
    });
    var seen = {};
    want.forEach(function (w) { seen[w.url] = true; });
    Object.keys(byUrl).forEach(function (u) {
      if (!seen[u] && state.tombstones.indexOf(u) < 0 && byUrl[u].status !== 'Done') state.tombstones.push(u);
    });

    if (adds.length) tasks.getRange(tasks.getLastRow() + 1, 1, adds.length, 10).setValues(adds);
    if (adds.length || dones) {
      hist.appendRow([new Date().toISOString(), 'gh-sync', '(auto)',
        adds.length + ' adds, ' + dones + ' dones' +
        (adds.length ? ' — ' + adds.map(function (a) { return a[0]; }).join('; ') : ''), 'Breadrich']);
    }
    state.lastRun = new Date().toISOString();
    props.setProperty('GHSYNC_STATE', JSON.stringify(state));

    var email = ghSyncProp_('NOTIFY_EMAIL', '');
    if (email && (adds.length || dones)) {
      MailApp.sendEmail(email, '[Work Tracker] gh-sync: ' + adds.length + ' adds, ' + dones + ' dones',
        adds.map(function (a) { return '+ ' + a[0] + ' → ' + a[2]; }).join('\n'));
    }
  } finally { lock.releaseLock(); }
}

function installGhSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'ghSyncHourly') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('ghSyncHourly').timeBased().everyHours(1).create();
}
