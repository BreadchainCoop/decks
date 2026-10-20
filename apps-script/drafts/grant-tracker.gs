/**
 * Grants tracker — mechanical pipeline automation (Apps Script)
 *
 * Paste into the grants tracker sheet's Apps Script project
 * ("Bread Coop List of Grants and funding"), then run installGrantTriggers() once.
 *
 * Three jobs, all mechanical, zero LLM:
 *   startAGrantSweep()  — daily 08:45. New rows on the "Start a Grant" tab:
 *     finds the funder's row on the Grants tab → stage Drafting + Team Member +
 *     next action + date, creates a grant doc (Google Doc) with the skeleton
 *     and the 📋 requirements block, links it in Document Link, emails the owner.
 *     (Apps Script cannot create tabs inside the Master doc — so intake creates
 *     a standalone doc; Breadrich still opens Master-doc tabs on request.)
 *   hygieneSweep()      — weekly Mon 08:15. Checks links on the Grants tab
 *     (Document Link + Website/URL column); flags dead links and past-due
 *     next actions. FLAG-ONLY: never deletes, never moves rows, never touches
 *     Stage/Tier/Owner/Outcome. Emails a digest only when something was flagged.
 *   discoverySweep()    — weekly Wed 08:25. Fetches the 8 sources (RSS + page
 *     hashes), appends new items to a "Discovery inbox" tab, emails the list.
 *     Fit-judgment stays with Breadrich — ask him to evaluate the inbox.
 *
 * Properties (Script Properties):
 *   NOTIFY_EMAIL  (required) — digest/owner-email fallback (e.g. gilberto@morishaw.com)
 *   TEAM_EMAILS   (optional) — JSON {"Gilberto":"…","Unai":"…"} for owner routing
 *   MASTER_DOC_ID (optional) — defaults to the real Master Applications doc
 */

var GT_MASTER_DOC_ID = '1h6X9_wSN_52MH-aVzslLcOEX2DRIPKzVzLaMHFnz5tI';
var GT_SOURCES = [
  { name: 'Ethereum Foundation blog', url: 'https://blog.ethereum.org/feed.xml', type: 'rss', category: 'Web3 Organization' },
  { name: 'NLnet news', url: 'https://nlnet.nl/news/', type: 'page', category: 'Foundation' },
  { name: 'Open Technology Fund news', url: 'https://www.opentech.fund/news/', type: 'page', category: 'Donor' },
  { name: 'CORDIS EU news', url: 'https://cordis.europa.eu/news', type: 'page', category: 'EU Grant/EU' },
  { name: 'EIT Community NEB', url: 'https://neb.eitcommunity.eu/', type: 'page', category: 'EU Grant/EU' },
  { name: 'Challenge Works news', url: 'https://challengeworks.org/news/', type: 'page', category: 'Foundation' },
  { name: 'Lever for Change network', url: 'https://leverforchange.org/our-network/', type: 'page', category: 'Donor' },
  { name: 'FLOSS/fund', url: 'https://floss.fund/', type: 'page', category: 'Corporate Grants' }
];

function gtProp_(key, dflt) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return (v === null || v === '') ? dflt : v;
}
function gtNotify_(subject, body) {
  var email = gtProp_('NOTIFY_EMAIL', '');
  if (email) MailApp.sendEmail(email, subject, body);
}
function gtOwnerEmail_(name) {
  var map = {};
  try { map = JSON.parse(gtProp_('TEAM_EMAILS', '{}')); } catch (e) {}
  return map[name] || gtProp_('NOTIFY_EMAIL', '');
}
function gtToday_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function gtSheet_(re) {
  var sheets = SpreadsheetApp.getActive().getSheets();
  for (var i = 0; i < sheets.length; i++) if (re.test(sheets[i].getName())) return sheets[i];
  return null;
}
/* header name → column index (1-based); first matching name wins */
function gtCols_(sheet) {
  var head = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0]
    .map(function (h) { return String(h).toLowerCase().trim(); });
  var m = {};
  head.forEach(function (h, i) { if (h && m[h] === undefined) m[h] = i + 1; });
  return m;
}
function gtCol_(m, names, dflt) {
  for (var i = 0; i < names.length; i++) if (m[names[i]] !== undefined) return m[names[i]];
  return dflt;
}

/* ── 1. Start a Grant intake ─────────────────────────────────────────── */
function startAGrantSweep() {
  var form = gtSheet_(/start a grant/i) || gtSheet_(/start-a-grant/i);
  if (!form) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var cols = gtCols_(form);
    var lastRow = form.getLastRow();
    if (lastRow < 2) return;
    var vals = form.getRange(2, 1, lastRow - 1, form.getLastColumn()).getValues();
    var fC = gtCol_(cols, ['funder', 'funder name'], 1);
    var gC = gtCol_(cols, ['grant', 'grant name', 'grant programme', 'program'], 2);
    var nC = gtCol_(cols, ['your name', 'name', 'team member', 'owner'], 3);
    /* handled marker lives 2 columns past the last header */
    var hC = form.getLastColumn() + 2;

    var grants = gtSheet_(/grant/i);
    var gc = gtCols_(grants);
    var stageC = gtCol_(gc, ['pipeline stage'], 18);          /* R */
    var memberC = gtCol_(gc, ['team member'], 0);
    var nextC = gtCol_(gc, ['next action'], 20);              /* T */
    var nextDateC = gtCol_(gc, ['next action date'], 21);     /* U */
    var linkC = gtCol_(gc, ['document link', 'doclink', 'doc link'], 0);
    var funderC = gtCol_(gc, ['funder', 'funder name'], 1);
    var grantNameC = gtCol_(gc, ['grant', 'grant name'], 2);
    var gLast = grants.getLastRow();
    var gVals = gLast > 1 ? grants.getRange(2, 1, gLast - 1, grants.getLastColumn()).getValues() : [];

    var handled = 0;
    for (var r = 0; r < vals.length; r++) {
      var row = vals[r];
      var funder = String(row[fC - 1] || '').trim();
      if (!funder || row[hC - 1]) continue;
      var grant = String(row[gC - 1] || '').trim();
      var who = String(row[nC - 1] || '').trim();
      var doc = gtCreateGrantDoc_(funder, grant);

      /* find the funder's row on the Grants tab (fuzzy: case-insensitive containment) */
      var hit = -1;
      for (var g = 0; g < gVals.length; g++) {
        var gf = String(gVals[g][funderC - 1] || '').toLowerCase();
        if (gf && (gf.indexOf(funder.toLowerCase()) >= 0 || funder.toLowerCase().indexOf(gf) >= 0)) { hit = g + 2; break; }
      }
      if (hit > 0) {
        grants.getRange(hit, stageC).setValue('Drafting');
        if (memberC && who) grants.getRange(hit, memberC).setValue(who);
        grants.getRange(hit, nextC).setValue('Draft — paste the call outline into the grant doc 📋 block, then confirm with Breadrich');
        grants.getRange(hit, nextDateC).setValue(gtToday_());
        if (linkC) grants.getRange(hit, linkC).setValue(doc.getUrl());
      }
      form.getRange(r + 2, hC).setValue('Apps Script ' + gtToday_());
      handled++;
      var email = gtOwnerEmail_(who);
      if (email) MailApp.sendEmail(email,
        'Grant started: ' + funder + (grant ? ' — ' + grant : ''),
        'Your grant doc is ready: ' + doc.getUrl() + '\n\n' +
        'Paste the call outline/questions into the 📋 requirements block at the top, then ask ' +
        'Breadrich in chat to draft against it. ' +
        (hit > 0 ? 'Tracker row updated (stage → Drafting).' :
          'NOTE: no matching row found on the Grants tab — add one and link the doc: ' + doc.getUrl()));
    }
    if (handled) PropertiesService.getScriptProperties().setProperty('GT_LAST_INTAKE', new Date().toISOString());
  } finally { lock.releaseLock(); }
}

function gtCreateGrantDoc_(funder, grant) {
  var doc = DocumentApp.create('Grant — ' + funder + (grant ? ' — ' + grant : ''));
  var body = doc.getBody();
  body.appendParagraph('📋 GRANT REQUIREMENTS — paste the call outline/questions here');
  body.appendParagraph('');
  ['Summary', 'Fit — why Bread / why this funder', 'Project description',
   'Budget', 'Team', 'Impact & dissemination', 'Risks'].forEach(function (h) {
    body.appendParagraph(h).setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendParagraph('');
  });
  body.appendParagraph('Preliminary material: Master Applications doc + Breadrich facts pack. Numbers only from numbers.md.');
  doc.saveAndClose();
  return doc;
}

/* ── 2. Hygiene (flag-only) ──────────────────────────────────────────── */
function hygieneSweep() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var grants = gtSheet_(/grant/i);
    if (!grants) return;
    var gc = gtCols_(grants);
    var nextC = gtCol_(gc, ['next action'], 20);
    var nextDateC = gtCol_(gc, ['next action date'], 21);
    var stageC = gtCol_(gc, ['pipeline stage'], 18);
    var linkC = gtCol_(gc, ['document link', 'doclink', 'doc link'], 0);
    var siteC = gtCol_(gc, ['website', 'url', 'source', 'link'], 0);
    var last = grants.getLastRow();
    if (last < 2) return;
    var vals = grants.getRange(2, 1, last - 1, grants.getLastColumn()).getValues();
    var today = gtToday_();
    var flags = [];
    for (var r = 0; r < vals.length; r++) {
      var row = vals[r];
      var stage = String(row[stageC - 1] || '');
      if (/won|lost|archived/i.test(stage)) continue;
      var flag = [];
      [linkC, siteC].forEach(function (c, i) {
        if (!c) return;
        var url = String(row[c - 1] || '').trim();
        if (url && /^https?:\/\//.test(url) && gtDead_(url)) flag.push((i === 0 ? 'Document link' : 'Website') + ' dead: ' + url);
      });
      var due = row[nextDateC - 1];
      var dueStr = due instanceof Date ? Utilities.formatDate(due, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(due || '');
      if (dueStr && /^\d{4}-/.test(dueStr) && dueStr < today && !/won|lost/i.test(stage) &&
          String(row[nextC - 1] || '').indexOf('⏰') < 0) {
        flag.push('past due (' + dueStr + ')');
        grants.getRange(r + 2, nextC).setValue('⏰ past due ' + dueStr + ' — ' + String(row[nextC - 1] || '').replace(/^⏰ past due \d{4}-\d{2}-\d{2} — /, ''));
      }
      if (flag.length) flags.push('Row ' + (r + 2) + ' (' + String(row[0] || '?') + '): ' + flag.join('; '));
    }
    PropertiesService.getScriptProperties().setProperty('GT_LAST_HYGIENE', new Date().toISOString());
    if (flags.length) gtNotify_('[Grants] hygiene: ' + flags.length + ' flag(s)',
      'Flag-only report (nothing was deleted):\n\n' + flags.join('\n'));
  } finally { lock.releaseLock(); }
}
function gtDead_(url) {
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      var opt = { muteHttpExceptions: true, followRedirects: true,
        headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)' } };
      var res;
      try { res = UrlFetchApp.fetch(url, Object.assign({ method: 'head' }, opt)); }
      catch (e) { res = UrlFetchApp.fetch(url, opt); }
      var code = res.getResponseCode();
      if (code === 405 || code === 501) res = UrlFetchApp.fetch(url, opt);
      code = res.getResponseCode();
      if (code < 400) return false;
      if (code === 404 || code === 410) return true;
      /* 401/403/405/429 = bot-walled, NOT dead */
      if (code === 401 || code === 403 || code === 429) return false;
    } catch (e) {
      if (attempt === 1) return true; /* DNS/refused after retry = dead */
    }
    Utilities.sleep(600);
  }
  return false;
}

/* ── 3. Discovery gate ───────────────────────────────────────────────── */
function discoverySweep() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var props = PropertiesService.getScriptProperties();
    var state = JSON.parse(props.getProperty('GT_DISCOVERY_STATE') || '{"seenLinks":[],"pageHashes":{}}');
    var fresh = !props.getProperty('GT_DISCOVERY_STATE');
    var newItems = [];
    GT_SOURCES.forEach(function (s) {
      var text;
      try { text = UrlFetchApp.fetch(s.url, { muteHttpExceptions: true,
        headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)' } }).getContentText(); }
      catch (e) { return; }
      if (s.type === 'rss') {
        var blocks = text.match(/<(item|entry)[\s\S]*?<\/(item|entry)>/gi) || [];
        blocks.forEach(function (b) {
          var title = (b.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
          title = title.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim();
          var link = (b.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1] ||
                     ((b.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || '').trim();
          var date = (b.match(/<(pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\/\1>/i) || [])[2] || '';
          var t = date ? new Date(date).getTime() : 0;
          if (!link || state.seenLinks.indexOf(link) >= 0) return;
          state.seenLinks.push(link);
          if (fresh) return;
          if (t === 0 || Date.now() - t < 14 * 864e5)
            newItems.push([new Date().toISOString().slice(0, 10), s.name, s.category, title.slice(0, 140), link, 'new']);
        });
      } else {
        var norm = text.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
        var h = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, norm));
        if (state.pageHashes[s.url] === undefined) { state.pageHashes[s.url] = h; return; }
        if (state.pageHashes[s.url] !== h) {
          state.pageHashes[s.url] = h;
          if (!fresh) newItems.push([new Date().toISOString().slice(0, 10), s.name, s.category,
            '(page changed — check for new calls/programs)', s.url, 'new']);
        }
      }
    });
    if (state.seenLinks.length > 800) state.seenLinks = state.seenLinks.slice(-800);
    props.setProperty('GT_DISCOVERY_STATE', JSON.stringify(state));
    if (!newItems.length) return;

    var ss = SpreadsheetApp.getActive();
    var inbox = gtSheet_(/discovery inbox/i);
    if (!inbox) {
      inbox = ss.insertSheet('Discovery inbox');
      inbox.appendRow(['Date', 'Source', 'Category', 'Title', 'Link', 'Status']);
    }
    inbox.getRange(inbox.getLastRow() + 1, 1, newItems.length, 6).setValues(newItems);
    gtNotify_('[Grants] discovery: ' + newItems.length + ' new item(s)',
      newItems.map(function (n) { return '• ' + n[3] + '\n  ' + n[1] + ' — ' + n[4]; }).join('\n') +
      '\n\nFiled in the Discovery inbox tab. Ask Breadrich to evaluate fit when ready.');
  } finally { lock.releaseLock(); }
}

/* ── install ─────────────────────────────────────────────────────────── */
function installGrantTriggers() {
  ['startAGrantSweep', 'hygieneSweep', 'discoverySweep'].forEach(function (fn) {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === fn) ScriptApp.deleteTrigger(t);
    });
  });
  ScriptApp.newTrigger('startAGrantSweep').timeBased().everyDays(1).atHour(9).create();
  ScriptApp.newTrigger('hygieneSweep').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).create();
  ScriptApp.newTrigger('discoverySweep').timeBased().onWeekDay(ScriptApp.WeekDay.WEDNESDAY).atHour(9).create();
}
