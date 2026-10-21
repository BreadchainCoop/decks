# Write-back web app (Work Tracker + Contributors)

> **New suite release:** the consolidated router, Bread HQ, both feed
> projections and hardened automation jobs are built and locally tested.
> Start with [`SUITE-DEPLOYMENT.md`](SUITE-DEPLOYMENT.md), not by combining the
> standalone `doPost` files below. `node apps-script/build-suite.cjs` creates
> one deployable `dist/Code.gs`; `node apps-script/tests/run-all.cjs` runs all
> seven local harnesses. No Google installation or production cutover has run.
>
> The supplied HQ sheet is `1olxp1zTy14eaY1yfTuDhqsWP1FnktxShgVXQamErplY`.
> `breadConfigureKnownStagingSheets()` records that and the supplied CRM copy;
> `breadHqSetup()` creates the four HQ tabs and seeds the two reference links
> once run by an authorized owner. These functions have **not** been run here.

The remainder documents the retained standalone Work/Contributors app and the
earlier automation installation path. Do not install both trigger sets together.

`work-tracker-write.gs` is the single Apps Script web app behind two decks:

- [`work-tracker.html`](../work-tracker.html) — task edits and new tasks.
- [`contributor-dashboard.html`](../contributor-dashboard.html) — signup
  ownership, status and triage scores, plus the matching outreach task in the
  Work Tracker.

One deployment, one URL, one `TOKEN`. Both decks run in copy-command mode until
`WRITE_URL` is set.

- Work Tracker sheet: `10vQRSVpiePANd1yNzSyua_PO5DCgk9muB_VqYIFDAkE`
  — writes the `Tasks` tab, logs every change to `History`
- Contributor Interest Form: `1ncGbPZyf0vH9NCsndvaUkmkJremWz1YW1_-YPpLRjxA`
  — writes the live tab `New Form Responses 25 Sept 2025`

`drafts/` holds the older mechanical jobs (GitHub → Tasks sync, grants
intake/hygiene/discovery). Their hardened replacements (`jobs-github.gs`,
`jobs-grants.gs`) are built and tested but **not deployed**; the drafts stay
until a week of matching output. The automation map — jobs, triggers, the Agent
Inbox and the token budget — is in [`../OVERVIEW.md`](../OVERVIEW.md) §4.

## Automation files

| File | Purpose |
|---|---|
| `bh-lib.gs` | namespaced helpers: dates, header maps, row find, locks, Agent Inbox, change detection, staging destination guard |
| `jobs-work.gs` | `breadWorkHygiene` — overdue / blocked / unowned / stale / over-WIP digest |
| `jobs-crm.gs` | `breadCrmFollowups` — silent 45d+, high-priority unowned, blocked; excludes archived campaigns |
| `jobs-contributors.gs` | `breadContributorGate` — new signups, 7d+ unowned, 30d+ waiting |
| `jobs-suite.gs` | `breadWeeklyRollup`, `breadContributorFormSubmit`, `breadHqBoundaries` |
| `jobs-github.gs` | `breadGithubSync` — dry-run proposals by default; bounded apply mode |
| `jobs-grants.gs` | `breadGrantIntake/Hygiene/Discovery` — inbox-first, exact-match intake |
| `install-suite-triggers.gs` | `breadInstallSuiteTriggers()` / uninstall / audit / preflight / run-all |
| `staging-config.gs` | `breadConfigureKnownStagingSheets()` — seeds the two user-supplied IDs only |
| `suite-web.gs` | the single consolidated router (one `doPost`, all domains) |
| `crm-migration.gs` / `crm-write.gs` / `crm-feed.gs` | CRM one-table migration, writes, feed projection |
| `hq-service.gs` / `hq-budget.gs` | Bread HQ records + aggregate budget scenario |
| `grants-service.gs` / `grants-feed.gs` | grants writes + allowlisted Targets/Stats projection |
| `build-suite.cjs` | builds `dist/Code.gs` from the modules above |
| `tests/*.cjs` | 8 harnesses: fake Sheets, migration, endpoint, feeds, router, jobs, dashboards, runtime config |

The jobs are **read-only over the source sheets** by default. Their only writes
are compact events in the Work Tracker's `Agent Inbox` tab, and only when the
digest changed since the last run. Quiet day ⇒ no rows ⇒ no model call. Explicit
`…_MODE=apply` properties opt specific jobs into bounded source writes.

### Deploy

**Use the consolidated path in [`SUITE-DEPLOYMENT.md`](SUITE-DEPLOYMENT.md).**
The generated `dist/Code.gs` already contains the library, jobs, triggers,
router and setup helpers; do not paste these files alongside it as separate
entry points. `install-triggers.gs` and the older three-job flow below are the
retained legacy path only — never install both trigger sets in one project.

Local check: `node apps-script/tests/run-all.cjs` — all 7 harnesses
(`--backend-only` skips the two dashboards that need the private `decks-src`).

### Agent Inbox

Tab in the Work Tracker sheet, created on first event:

`Timestamp · Source · Kind · Severity · Ref · Summary · Payload · Handled`

- `Source` is `work`, `crm` or `contributors`.
- One live event per source/kind; it updates only when the situation changes.
- A cleared condition resets the signature, so a recurrence notifies again.
- `Handled` is the agent's flag; the jobs never touch it.

## CRM migration (copy-only stage)

The ten per-campaign tabs become one `Contacts` table with stable IDs, so a
campaign can be archived or deleted without touching a contact. The full plan —
schemas, field mapping, quirks (Artizen's variant, Neo bank's repeated header,
Devconnect's gid 0), validation counts, cutover and rollback — is in
[`MIGRATION-CRM.md`](MIGRATION-CRM.md).

Campaign create/archive and the Bread HQ campaign list build on that migration,
not before it.

`crm-migration.gs` implements the source scan, seeded `Campaigns` registry,
single `Contacts` table, stable IDs, `_migration_map`, conflict-safe reruns and
validation **on a copy only**. The production and feed sheet IDs are explicitly
blocked. It does not write to the live sheets, project the feed or update the
dashboard/write app.

To rehearse with an account that has **edit access** to an editable *copy* of
the CRM spreadsheet:

1. Make a copy of the CRM spreadsheet in Drive; retain all campaign tabs and
   note the **copy's** spreadsheet ID from its URL. No production freeze is
   needed for this rehearsal.
2. Add `crm-migration.gs` to an Apps Script project with access to that copy.
   In the editor, invoke `breadCrmPreviewCopy("<copy ID>")`, then
   `breadCrmMigrateCopy("<copy ID>")`, then
   `breadCrmValidateCopy("<copy ID>")` (for example, using temporary wrapper
   functions that pass the ID). Never paste the production ID.
3. Inspect the validation report and the `Contacts`/`Campaigns`/
   `_migration_map` tabs. The read-only 2026-10-21 source baseline was 208
   contacts and 25 non-empty last-connected values (some unparseable); changed
   live counts require review, not automatic rejection or truncation.

Local synthetic test: `node apps-script/tests/crm-migration-harness.cjs`.
Staging migration/deployment on a real copy and verification of the new feed,
dashboard and write path are still required before a live cutover. Do not expose
this migration file alongside
`work-tracker-write.gs` as a web-app write operation.
The CRM dashboard currently posts to a **different** deployed Apps Script URL;
its source is not in this repo. Per the agreed approach, `crm-write.gs` is a
new standalone replacement, to install later alongside the new client.
Installation, the API contract and staging caveats are in
[`CRM-WRITES.md`](CRM-WRITES.md). Editing the Work/Contributors endpoint does
not replace the CRM endpoint.

`crm-feed.gs` projects the consolidated CRM to a **separate staging feed**:
Contacts (no Method/private Notes), Campaigns, stable-ID Links and History.
With `CRM_FEED_ID` configured in the new write project, successful writes also
refresh that staging feed. Both known production sheet IDs are blocked by the
projection. The dashboard source supports this contract behind its disabled
`CRM_V2` configuration; the encrypted production HTML has not changed.

The user's staging CRM copy is
`1yt--g8XMWJxkkJMcodbbDxN_y7KVwgqdb3XmDbsEV_E`; a read-only inventory confirmed
all 208 contacts across ten campaigns. No migration has been run on that copy.
See [`CRM-WRITES.md`](CRM-WRITES.md) for the remaining staging steps.

## Deploy

1. Open the Work Tracker sheet → **Extensions → Apps Script**.
2. Replace `Code.gs` with the contents of `work-tracker-write.gs`.
3. Set `TOKEN` to a long random string (and leave `SPREADSHEET_ID` as is).
4. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Copy the **`/exec` URL**.

> "Anyone" is required so the static pages can reach it. The `TOKEN` is what
> actually authorises writes — treat it as a shared secret and don't commit it
> to a public place.

The script runs **as you**, so your account needs **edit** access to both
sheets. If you only have view access to the interest form, the contributor ops
fail with a permission error (or "no live form tab"); work-tracker ops keep
working.

## Wire it into the decks

In both plaintext sources (inside the encrypted payload — ask a maintainer with
the deck password):

```js
const WRITE_URL = "https://script.google.com/macros/s/…/exec";
const WRITE_TOKEN = "…";
```

Re-encrypt and redeploy. If a write fails, each deck reverts the optimistic
change and copies a Breadrich command instead — nothing is silently lost.

## Contract

`POST`, `Content-Type: text/plain;charset=utf-8`, JSON body.

### Work Tracker

```jsonc
// change fields on an existing task
{ "token": "…", "op": "update", "row": 12, "task": "Follow up on NGI…",
  "patch": { "Status": "Review", "Owner": "Unai" } }

// append a task
{ "token": "…", "op": "add",
  "fields": { "Task": "…", "Project": "Grants", "Status": "Backlog" } }
```

Only the headers in `REQUIRED_HEADERS` are writable; unknown keys are ignored
and reported back in `changed`.

### Contributor dashboard

```jsonc
// status, owner or a triage score on one signup
{ "token": "…", "op": "contributor.update", "signupRow": 43,
  "name": "Zaal Panthaki", "timestampMs": 1791265159000,
  "patch": { "Status": "Contacted", "Vibe": 4 } }

// assign an owner + upsert the outreach task
{ "token": "…", "op": "contributor.assign", "signupRow": 43,
  "name": "Zaal Panthaki", "timestampMs": 1791265159000, "owner": "Unai",
  "task": { "Task": "Welcome Zaal Panthaki — contributor outreach",
            "Project": "Contributors", "Owner": "Unai", "Status": "Backlog",
            "Priority": "Medium", "Due": "2026-10-27",
            "Contact / Org": "Zaal Panthaki",
            "Notes": "[ctr:2026-10-06:zaal-panthaki] signup …" } }
```

- `signupRow` is a hint; the script re-checks **name + timestamp** (±2 min)
  before writing, so a shifted row can’t hit the wrong person.
- Writable signup fields: `Status`, `Contact person`, and the five eval columns
  (`Value aligned`, `Skills needed`, `Vibe`, `Reliability`, `Others`). Missing
  eval columns are appended on first write.
- `contributor.assign` sets the contact person on the interest sheet and
  **upserts** one Work Tracker task, matched by the `[ctr:…]` marker at the
  start of its Notes. Existing task → owner updated; no task → appended.
- The interest form sheet has no history tab, so only the Work Tracker side is
  logged in `History`.
