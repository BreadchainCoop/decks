# Bread suite — consolidated release

**Code, local tests and the five encrypted surfaces are complete for this
release. Nothing in this runbook means a Google deployment, sheet migration or
publication (git push) has run.** The five HTML files in the repository root
are the new release, encrypted with the shared salt and round-trip verified:
`index.html` is Bread HQ in **explicitly-labelled local-demo mode** (no
endpoint configured yet); the four dashboards carry the new code while keeping
their prior production contracts (CRM `CRM_V2` disabled, Grants edit hidden
without a write URL), so behaviour is unchanged until cutover. Everything below
§2 onward is still outstanding before the suite actually goes live.

## What is built

- Bread HQ (`decks-src/bread-hq/`, encrypted output `index.html`): four product
  entry cards, resources, committee directives, shared time off, authoritative
  master-doc link and an aggregate-only budget scenario panel.
- CRM: one-table migration, stable-ID writes and links, Campaigns registry,
  create/archive/restore UI, archived-contact access and feed projection.
- Grants: verified source-header aliases, pipeline-field writes and allowlisted
  Targets/Stats projection. Confirmed fundraising amounts are preserved, never
  inferred from grant sizes. Applications are never submitted by the script.
- One namespaced web router for Work, Contributors, CRM, Grants and HQ.
- GitHub sync, grant intake/hygiene/discovery, work/CRM/contributor gates, instant
  form gate, HQ date boundaries, weekly rollup, trigger installer and audit.

All four original product colours and hover previews remain. Every product's
Bread logo links back to HQ. HQ uses the shared shell and a neutral accent.

## Known sheets and references

| Purpose | ID | Current status |
|---|---|---|
| CRM rehearsal copy supplied by user | `1yt--g8XMWJxkkJMcodbbDxN_y7KVwgqdb3XmDbsEV_E` | read-only inventory confirmed 208 contacts; not migrated |
| New Bread HQ sheet supplied by user | `1olxp1zTy14eaY1yfTuDhqsWP1FnktxShgVXQamErplY` | supplied/opened; setup function not executed |
| Existing Work production | `10vQRSVpiePANd1yNzSyua_PO5DCgk9muB_VqYIFDAkE` | unchanged |
| Existing Contributors production | `1ncGbPZyf0vH9NCsndvaUkmkJremWz1YW1_-YPpLRjxA` | unchanged |
| Existing CRM production | `1c4PgSHC2N2n7VsFHhYH0PMvtQljvZg-ZQo6MtOojVYY` | unchanged |
| Existing CRM feed | `19Lxe0C14BOYbOj0Z0nyoQc4-I_aw_jgybcq9LggfcUw` | unchanged |
| Existing Grants tracker | `1Rm_rucOcAbcJTHQG7U84xFOi0fw3ZM2jT9M8R_adwME` | schema inspected read-only; unchanged |
| Existing Grants feed | `1OmGfZO9BUhNFY1JEiIkRWY9eEnvW7x3fTtckXeqLa-Q` | unchanged |
| Directives master | `1NsvX9b544yW8Bj8ZvozowrAqZ3dbgvClvy-9r9VT3dU`, tab `t.253tlm5pp47g` | authoritative; inspected section was Draft, approval unconfirmed |
| Budget calculator | `1iWZXv2yaquz_oRlYGCn0jhJYsVuseea6e0aE2EpYsx8`, gid `1139000984` | read-only aggregate adapter; linked scenario labelled Q3 2026 |

HQ does not import a draft as adopted policy. Its directives are committee
summaries with publication status; the master document stays authoritative.
Budget figures are labelled scenario inputs/results, not current verified
balances. Only A1:B10 is read; member-by-member hours/pay are not exported.

## 1. Build and test (no Google access)

```powershell
node apps-script/tests/run-all.cjs
node apps-script/build-suite.cjs
```

The bundle is `apps-script/dist/Code.gs` (generated/ignored). It contains exactly
one `doPost` and one `doGet`; standalone handlers are renamed by the build.
Do not paste the unrenamed standalone scripts beside it. Legacy draft jobs and
the old trigger installer are excluded.

The full test command requires the sibling private `decks-src` folder. For a
backend-only checkout, explicitly use `node apps-script/tests/run-all.cjs
--backend-only`; this does **not** claim UI/build coverage.

## 2. Configure the Google staging project

Create a **new** Apps Script project using an account that can edit all selected
sheets, paste the generated `Code.gs`, and authorize its requested scopes.
Use an isolated project and **copies**, not the live Work/Contributor/Grants
sheets or feeds. Do not install triggers yet.

Run `breadConfigureKnownStagingSheets()` once. This fills only the supplied CRM
copy, the new HQ sheet and `BREAD_ENVIRONMENT=staging`, and refuses to overwrite
conflicting settings. It does not create tokens or touch sheet contents.

Set these **Script Properties**:

| Property | Value |
|---|---|
| `BREAD_ENVIRONMENT` | `staging` initially |
| `BREAD_WRITE_TOKEN` | random member secret, 32+ characters |
| `HQ_COMMITTEE_TOKEN` | **different** random secret, 32+ characters |
| `WORK_SPREADSHEET_ID` | Work Tracker **copy**, also hosts Agent Inbox |
| `CONTRIB_SPREADSHEET_ID` | interest-form **copy**, preserving its live-tab name |
| `CRM_SPREADSHEET_ID` | supplied CRM copy |
| `CRM_FEED_ID` | separate CRM-feed **copy** |
| `CRM_GID_CONTACTS` | Contacts gid in that feed (copies normally retain it) |
| `GRANTS_SPREADSHEET_ID` | Grants tracker **copy**, not the Targets feed |
| `GRANTS_FEED_ID` | separate Grants-feed **copy** |
| `HQ_SPREADSHEET_ID` | supplied empty Bread HQ sheet |
| `HQ_BUDGET_SPREADSHEET_ID` / `HQ_BUDGET_GID` | optional; defaults to the user-supplied calculator reference |
| `GITHUB_SYNC_ENABLED` | absent/false until dry-run review |
| `GITHUB_TOKEN` | optional API headroom; never printed or put in a deck |
| `GITHUB_SYNC_MODE` / `GRANTS_INTAKE_MODE` | default `inbox`; `apply` is an explicit later opt-in |

The consolidated build has **no implicit production destinations**. In staging,
known existing production IDs are rejected on write paths. This guard does not
magically recognize every possible production spreadsheet: verify all configured
IDs yourself, including any new sheets.

### Source schemas verified

- Grants uses `Organizational Name` / `Grant Name`; the feed uses `Funder` /
  `Grant`. Both canonical names and verified aliases are supported. Writes
  match the funder exactly and reject ambiguity; when one organisation holds
  several grants, pass `grant` as well or the request is refused rather than
  applied to the first matching row.
- The tracker's legacy stage column is `Approach`; the canonical
  `Pipeline Stage` (and `Document Link`, `Tier`, `Next Action`,
  `Next Action Date`, `Submitted On`, `Outcome`) are appended after it. Existing
  rows already carry canonical stages, so the dashboard is not blank — but do
  not confuse the two vocabularies.
- `Start a Grant` has instructions on rows 1–2 and its actual header on row 3.
  Existing `Status (Breadrich fills this)` entries are treated as handled.
  New fixed marker columns are appended on that header row, never guessed from
  the current last-column number on each run.
- CRM quirks and the exact field map are in [MIGRATION-CRM.md](MIGRATION-CRM.md).

## 3. Prepare the sheets

1. Run `breadHqSetup()`. It creates Resources, Directives, TimeOff and History;
   it leaves any existing Sheet1 untouched. It seeds **only** the two supplied
   reference links. No draft directive is automatically published, and no
   financial values are copied into the HQ sheet.
2. On the CRM copy, run the preview/migration/validation wrappers described in
   [CRM-WRITES.md](CRM-WRITES.md), then `breadCrmPrepareWriteSchemaCopy()`.
3. Run `breadCrmRefreshFeedCopy()` and `breadRefreshGrantsFeed()`. Save the returned
   gids for the staging build. Source and feed IDs must be distinct.
   Then make the **feeds** readable by the people testing the decks: a sheet
   copy does *not* inherit "publish to web" or link sharing, and the dashboards
   read feeds through `gviz`, so an unshared feed renders as an empty
   dashboard. Share each staging feed as **Anyone with the link · Viewer**
   (published feeds keep their production state). The Work and Contributor
   source copies need the same treatment for their dashboards. Keep the CRM
   source and the Grants tracker private — they hold notes the feeds omit.
4. Run `breadSuitePreflight()`. It is read-only and reports missing configuration
   and tabs; it cannot prove edit access. Exercise scratch writes to verify that.

**HQ permissions:** ordinary members can edit time off through the web app
running as the deployer; they do not need blanket editor access to the underlying
sheet. Keep sheet editors restricted to trusted maintainers/committee, or protect
the Directives tab if members also edit the raw TimeOff sheet. A committee token
protects the API, not direct edits by someone who already owns/edits the sheet.
No sharing settings are changed by the setup code.

## 4. Deploy the one staging endpoint

Deploy a web app, **Execute as: Me**, **Who has access: Anyone**; use the `/exec`
URL. Every data read/write requires the member token. `GET` exposes only service
metadata. Directive reads include drafts only with the separate committee token;
directive writes require it. The committee secret is entered in a password field
and held in page memory only, never in localStorage or the encrypted payload.

Supported operations:

| Domain | Operations / identity |
|---|---|
| Work | `work.update`, `work.add`; legacy `update`/`add` accepted for Work only. Updates require task title + row hint. Legacy CRM-shaped packets reject. |
| Contributors | `contributor.update`, `contributor.assign`; name + timestamp required, row only a hint; assignment upserts the task marker. |
| CRM | `contact.update/mark/add/link/unlink`, `campaign.create/archive/restore`; `crm.update/mark/add/link/unlink` aliases use the same **stable-ID** contract. |
| Grants | `grants.update`, `grants.stage`; exact funder identity, ambiguous labels reject rather than guessing. |
| HQ | `hq.read`, `hq.resource.add/update/archive`, `hq.directive.add/update/archive`, `hq.timeoff.add/update/archive`; updates require `expectedUpdatedAt`. |

Archive/cancel preserves rows. No campaign/contact hard-delete operation exists.
History logs field names, not private changed values. Shared bearer tokens are
not per-user identity; `by` is a self-reported audit label. Sheets operations are
not transactions: reconcile after an ambiguous service failure before retrying
adds. No script makes external submissions or sends email.

Both projections refresh after their domain's successful writes. Projection
failure returns `ok:true, feedUpdated:false`, not an apparent rejection of an
already committed edit. A later explicit refresh repairs it.

## 5. Build the five encrypted surfaces

The editable HTML lives outside this public repo in `decks-src`. Builds inject
runtime configuration **in memory**; no member token is written into plaintext
source. The token exists in the encrypted payload and becomes accessible to an
unlocked member, so it must never be treated as per-person authentication.

Provide `STATICRYPT_PW` via the local process environment (not a committed file).
The shared suite salt is `87dfddc04efd9c2087e749b9d8893c29`.

Runtime environment variables:

- `BREAD_SUITE_URL`, `BREAD_MEMBER_TOKEN` (matches `BREAD_WRITE_TOKEN`).
- `BREAD_WORK_SOURCE_ID`, `BREAD_WORK_TASKS_GID`, `BREAD_WORK_HISTORY_GID`.
- `BREAD_CONTRIB_SOURCE_ID`, optional `BREAD_CONTRIB_TAB` if renamed.
- `BREAD_GRANTS_SOURCE_ID`, `BREAD_GRANTS_FEED_ID`,
  `BREAD_GRANTS_TARGETS_GID`, `BREAD_GRANTS_STATS_GID`.
- `BREAD_CRM_V2=true`, `BREAD_CRM_SOURCE_ID`, `BREAD_CRM_FEED_ID`,
  `BREAD_CRM_CAMPAIGNS_GID`, `BREAD_CRM_CONTACTS_GID`,
  `BREAD_CRM_LINKS_GID`, `BREAD_CRM_HISTORY_GID`;
  optional `BREAD_CRM_SPEAKERS_GID` / `BREAD_CRM_INVITES_GID`.

**Reads and writes must use the same staging source.** The runtime configurator
requires explicit Work/Contributors/Grants source IDs when enabling their suite
writes, instead of leaving production reads pointed at a staging writer. It
also rewires cross-product Grants reads to the staging Grants feed.

From `decks-src`:

```powershell
node release.mjs --out-dir "$env:LOCALAPPDATA\Temp\opencode\bread-suite-release"
```

This builds, encrypts and verifies `index.html` plus all four dashboards with
the same salt. It does **not** push git, deploy Apps Script, or modify a sheet.
`--allow-demo` explicitly permits an unconfigured preview, never a live release.
The unconfigured HQ visibly labels its examples **LOCAL DEMO** and disables writes.

## 6. Staging acceptance and triggers

- Create an empty campaign, add a synthetic contact, edit, mark, link/unlink,
  archive/restore; confirm every contact remains and source row links resolve.
- Exercise Work writes, contributor ownership + task upsert, and exact-funder
  Grants edits against copies. Verify both projections after saves.
- Add/edit/cancel time off as a normal member; test stale-edit rejection.
- Verify normal members cannot read drafts or write directives, then draft and
  publish a **synthetic** directive with committee authorization.
- Confirm budget scenario labels, master-doc link, no per-member pay export,
  four colour accents/hover previews and HQ navigation.
- Run `breadRunSuiteJobsNow()` in default inbox-only modes, inspect Agent Inbox,
  rerun without changes and verify silence. No job itself calls a model.
- Run `breadInstallSuiteTriggers()` once after review; then
  `breadSuiteTriggerAudit()`. Installation is idempotent, preserves unrelated
  triggers, seeds form/HQ baselines and records the script timezone.

| Job | Schedule | Source changes |
|---|---|---|
| Work hygiene | daily 09:00 | none; inbox only |
| CRM follow-ups | daily 09:15 | none; archived campaigns excluded |
| Contributor gate | daily 09:30 + form submit | cursor + inbox only |
| Weekly rollup | Monday 08:00 | changed totals only, not a weekly forced wake |
| HQ date boundaries | daily 08:10 | changed away/current-directive sets only |
| GitHub | hourly, explicitly enabled | dry run by default; `apply` caps at 25 managed writes |
| Grant intake | daily 08:45 | dry run by default; `apply` caps at 10 exact-match requests |
| Grant hygiene | Monday 08:15 | flag-only; rotates up to 20 URL checks per run |
| Grant discovery | Wednesday 08:25 | silent baseline; changed sources enter Discovery Inbox and Agent Inbox |

GitHub search/pagination failures abort before task mutations. Managed markers
are independent per PR/review/issue assignment; human deletions create durable
tombstones. Human rows and human-modified statuses are not auto-completed.
Legacy `gh-sync` rows without stable markers remain human/legacy-owned until
explicitly reconciled; the new job does not adopt them silently.

Grant intake reuses existing doc links and recovers partially created docs using
a durable intake marker; it never fuzzy-matches a funder or overwrites a finished
application. Discovery changes are review candidates, not automatically endorsed
opportunities. A quiet rerun (including merely one more day of age) emits no new
event. Breadrich must poll **unhandled inbox rows without an LLM** and invoke a
model only when events need judgment; consumer deployment is a separate step.

## 7. Production cutover — explicit, after rehearsal

1. Retain the old deployments and all legacy campaign tabs. Back up **both**
   CRM source and feed. Keep original tab names during the rollback window.
2. Announce/coordinate the write freeze; do not infer that nobody is editing.
3. In the production project set `BREAD_ENVIRONMENT=production`,
   `CRM_CUTOVER_APPROVED=true`, `CRM_WRITE_FREEZE_CONFIRMED=true`,
   `CRM_SOURCE_BACKUP_ID`, `CRM_FEED_BACKUP_ID`, and the reviewed production IDs.
4. Run `breadCrmMigrateProduction()`. It verifies the legacy campaign data
   matches the source backup before writing. Then run
   `breadCrmPrepareWriteSchemaProduction()` and `breadCrmRefreshFeedProduction()`.
   Copy helpers remain copy-only; production entry points are not web operations.
5. Verify scratch writes and actual records; rebuild/encrypt with the production
   runtime IDs, and switch **reads + writes together**. Remove the freeze flag
   once cutover completes. Do not leave an old row-based client on a new feed.
6. Monitor a week, reconcile outputs with the old jobs/watchers, then explicitly
   retire them. Do not delete draft files, old deployments or user work as a
   substitute for proving parity.

Rollback is **not** only a URL flip: stop new writes, preserve/export any new
table-only edits, restore the pre-cutover feed contents and old dashboard/app,
then reconcile those post-cutover edits before reopening old writes. Keep the
new tables/map and backups; do not delete contact records. No automated legacy
tab deletion is provided.

## Current external work still outstanding

The supplied HQ sheet is not yet populated by the script. No Apps Script project
has been installed/authorized/deployed here, no real CRM migration has run, and
the team deck password is not present in this session's environment. Remaining
staging copies (Work, Contributors, Grants and the two feeds), owner authorization,
secrets, encrypted release verification and coordinated cutover are required.
All local build/test artifacts are ready to support those steps; do not mark
the live rollout complete until the Google checks above pass.
