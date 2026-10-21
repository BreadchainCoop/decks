# CRM migration — one Contacts table

**Decision:** consolidate the ten per-campaign tabs into a single `Contacts`
table now, so a campaign is metadata rather than a container. After this,
creating or deleting a campaign can never touch a contact record.

Status: **copy-only migration, standalone CRM writes, staging feed projection,
and feature-gated dashboard support implemented and tested locally. No real-sheet
migration or deployment yet.** Production sheet:
`1c4PgSHC2N2n7VsFHhYH0PMvtQljvZg-ZQo6MtOojVYY` (the real CRM sheet).
The dashboard reads the separate feed
`19Lxe0C14BOYbOj0Z0nyoQc4-I_aw_jgybcq9LggfcUw`; that feed is rebuilt in step 6.

Staging CRM copy provided by the user:
`1yt--g8XMWJxkkJMcodbbDxN_y7KVwgqdb3XmDbsEV_E`. A read-only inventory confirms
208 contacts with the same ten per-campaign counts. A separate staging feed
copy is required before installing the projection. Runbook:
[`CRM-WRITES.md`](CRM-WRITES.md).

## 1. Why

Today a campaign **is** a tab. The Contacts feed is a union of those tabs, and
every row is identified by `campaign + row`. Deleting a campaign means deleting
its tab, which deletes its contacts. That is the one operation the team needs
that the model forbids.

One table fixes it:

- a campaign becomes a row in `Campaigns` (name, owner, status);
- a contact row carries `CampaignID`, so archiving or deleting a campaign is
  metadata, never a row deletion;
- creating a campaign is an insert — no tab copy, no header drift;
- the dashboard, write app and automations all read one stable shape.

## 2. Non-goals

- **Not** merging duplicate people. Seven contact labels appear in more than one
  campaign (`febea`, `miso`, `enspiral`, …). Keep one row per campaign
  relationship; the existing bridge/identity model still decides what is "the
  same person".
- **Not** adding coordinates to the public feed. `Communication Method Used`
  contains emails/phones and stays out of the dashboard feed, as today.
- **Not** changing the grants, work or contributor sheets.

## 3. Current state (verified 2026-10-20)

208 real contact rows across ten tabs.

| Campaign | Rows | Schema |
|---|---:|---|
| Stacks | 48 | standard |
| SSE/IRL | 32 | standard |
| Artizen | 28 | **variant** |
| Devconnect 2025 | 25 | standard |
| Critical Technologist Collective? | 21 | standard |
| Neo bank | 19 | standard + repeated header row |
| Safety net | 13 | standard |
| Berlin Blockchain Week 2026 | 8 | standard |
| Client work | 8 | standard |
| Solidarity Fund | 6 | standard |

**Standard columns (11):**
`Contact / Team · Priority · Goal · Owner · Status · Action Steps · Project ·
Deliverable · Last Time Connected · Location Met · Communication Method Used`

**Artizen (10):** `Type` replaces `Goal` and there is no `Deliverable`.

**Quirks to handle in code, not by hand:**

- Devconnect's feed `GID` is `0` (the URL default). Resolve tabs by **name**.
- Neo bank has a second header row inside the data. Skip any row whose contact
  is `Contact / Team`.
- Contact values are sometimes URLs or org names, not people. Keep verbatim.
- Owners carry typos/suffixes (`daopunk?`, `blessing?`). Keep raw; normalise in
  the app, not the data.
- `Last Time Connected` is free text (`24Feb 2025`, `Jan 2025`, `ongoing`).
  **25 source rows** have a value (the old feed exposed only 19). Yearless
  values like `2 Apr` and `24th March` must remain raw and flagged, not assigned
  a guessed year.
- Status vocabulary: 70 `Contacted`, 13 `Not contacted`, 4 `Blocked`,
  3 `Completed`, 1 `Declined`, **117 blank**.
- Priority: 35 `High`, 4 `Immediate`, 68 `Low`, **101 blank**.
- `Links` currently has **0 rows**; `History` has 10. Links can be migrated
  without data loss; History gets a new ID column.

## 4. Target model

### 4.1 `Campaigns` (new tab, CRM sheet)

| Column | Meaning |
|---|---|
| `CampaignID` | slug, unique, stable (`devconnect-2025`) |
| `Campaign` | display name (safe to rename) |
| `Status` | `Active` / `Archived` |
| `Owner` | core-team owner |
| `Description` | one line: what this campaign is for |
| `Goal` | what success looks like |
| `Created` | date |
| `Archived` | date or blank |
| `Sort` | integer for nav order |

Seed a row for every current tab. Devconnect stays `Active` unless the team
says otherwise. Deleting = `Status = Archived`; `Archived` is set. A hard purge
is a separate, explicit op that refuses if rows still reference the campaign.

### 4.2 `Contacts` (new tab, CRM sheet)

| # | Column | Notes |
|---|---|---|
| 1 | `ContactID` | `c_` + 10 hex from SHA-256(`campaignID|legacyRow|contact`); `-2` suffix on collision. New contacts get `c_` + 16 random hex, checked for uniqueness |
| 2 | `CampaignID` | registry key |
| 3 | `Campaign` | denormalised label, for the feed and readability |
| 4 | `Contact` | verbatim from `Contact / Team` |
| 5 | `Org` | blank for now; the dashboard derives org where it can |
| 6 | `Priority` | raw (`Immediate` / `High` / `Low` / blank) |
| 7 | `Status` | raw (`Contacted` / `Not contacted` / `Blocked` / `Completed` / `Declined` / blank) |
| 8 | `Goal` | standard tabs |
| 9 | `Type` | Artizen only; blank elsewhere |
| 10 | `Owner` | raw |
| 11 | `Action` | from `Action Steps` |
| 12 | `Project` | raw |
| 13 | `Deliverable` | raw (blank for Artizen) |
| 14 | `LastConnectedRaw` | free text |
| 15 | `LastConnectedDate` | normalised `yyyy-mm-dd` or blank; raw text retained if unparseable |
| 16 | `LocationMet` | raw |
| 17 | `Method` | **coordinates; never projected to the feed** |
| 18 | `CreatedAt` | migration timestamp |
| 19 | `UpdatedAt` | last write |
| 20 | `LegacyCampaign` | old tab name |
| 21 | `LegacyRow` | old row number |
| 22 | `LegacyGID` | old tab gid (0 for Devconnect) |
| 23 | `Notes` | migration flags (e.g. `unparsed date`) |

Freeze row 1, add data validation for `Status` and `Priority`, and set the
`CampaignID` column to a registry lookup.

### 4.3 `Links` (feed/source tab) — future-proof, no data today

Keep the current columns and **add** the IDs; old rows can stay blank:

`Timestamp · Type · LeftCampaign · LeftRow · LeftContact ·
RightCampaign · RightRow · RightContact · Note · By · LeftContactID · RightContactID`

New writes fill IDs only. The dashboard prefers IDs, falls back to
campaign+row.

### 4.4 `History`

Add `ContactID` at the end:

`Timestamp · Op · Campaign · Contact · Detail · By · ContactID`

New writes fill it. Old rows stay legacy; the UI matches on ID first, then
campaign+contact.

### 4.5 Feed projection

Rebuild the feed's `Contacts` tab (keep its gid `1045890393` stable) with the
**same first 13 columns** plus new ones at the end, so the old dashboard keeps
working during parallel run:

`Campaign · Contact · Priority · Goal · Owner · Status · Action · Project ·
Deliverable · LastConnected · LocationMet · Row · GID · ContactID ·
CampaignID · Type`

- `Row` = row in the new `Contacts` tab.
- `GID` = the `Contacts` tab's gid.
- `Method` is **excluded**.
- `LastConnected` uses `LastConnectedDate` when present, else the raw text.

## 5. Field mapping

| Source | Target |
|---|---|
| `Contact / Team` | `Contact` |
| `Priority` | `Priority` |
| `Goal` (standard) | `Goal` |
| `Type` (Artizen) | `Type` |
| `Owner` | `Owner` |
| `Status` | `Status` |
| `Action Steps` | `Action` |
| `Project` | `Project` |
| `Deliverable` | `Deliverable` |
| `Last Time Connected` | `LastConnectedRaw` + parsed `LastConnectedDate` |
| `Location Met` | `LocationMet` |
| `Communication Method Used` | `Method` (kept out of the feed) |
| tab name | `Campaign` + `LegacyCampaign` |
| row number | `LegacyRow` |
| tab gid | `LegacyGID` |
| — | `ContactID`, `CampaignID`, `CreatedAt`, `UpdatedAt` |

Parsing rules for `LastConnectedRaw`:

- `yyyy-mm-dd` → as-is.
- `d Mon yyyy`, `Mon yyyy`, `Mon yyyy` without day → first of month.
- `d/m/yyyy` → month-first when unambiguous; day-first when the first part is
  > 12.
- Anything unresolved: keep raw, leave date blank, write `unparsed date` in
  `Notes` for review.

## 6. Procedure

### Step 0 — make the rehearsal copy

1. **File → Make a copy** of the whole CRM spreadsheet; name it
   `CRM backup YYYY-MM-DD pre-consolidation`.
2. Record row counts (table in §3) and the History row count. Live writes can
   continue during this rehearsal; only step 8 needs a write freeze.
3. Export every campaign tab to CSV before the production cutover (for a
   second rollback path), not as a prerequisite for local tests.

### Step 1 — registry

On the copy, create `Campaigns`, seed the ten rows, and give every tab a `CampaignID`.
Do **not** rename tabs yet.

### Step 2 — target tab + migration map

Create `Contacts` with the headers in §4.2. Create `_migration_map`:

`LegacyCampaign · LegacyRow · LegacyGID · ContactID · NewRow · Flag · TargetHash`

`TargetHash` fingerprints the imported columns. A rerun refuses to overwrite a
manually edited imported cell; an unchanged rerun is a no-op. The optional
`Org` field is preserved on a source-delta rerun.

### Step 3 — migrate

The copy-only Apps Script in [`crm-migration.gs`](crm-migration.gs) provides
`breadCrmPreviewCopy(copyId)`, `breadCrmMigrateCopy(copyId)` and
`breadCrmValidateCopy(copyId)`. It refuses the known production and feed IDs.
The migration algorithm is:

```
read Campaigns
for each campaign row:
  tab = sheet by display name (not gid)
  find header row: first row containing "Contact / Team"
  map headers by name, case/space-insensitive
  for each row after the header:
    skip blank contact
    skip if contact == "Contact / Team"      // repeated header
    build target row from §5
    ContactID = stable hash; suffix on collision
    if already mapped and unchanged: do nothing
    if already mapped and source changed: update only if target hash matches
    else append to Contacts and _migration_map
batch-write (500 rows/request)
```

Rules: no formatting depends on source order; no merging; no deletes.

### Step 4 — validate before touching the feed

Automated checks, then a human spot-check:

- [ ] 208 rows in `Contacts`.
- [ ] Per-campaign counts exactly §3 (48, 32, 28, 25, 21, 19, 13, 8, 8, 6).
- [ ] Every row has a unique `ContactID`.
- [ ] No blank `Contact`; no `Contact / Team` rows.
- [ ] Status counts: 70 / 13 / 4 / 3 / 1 / 117 blank.
- [ ] Priority counts: 4 / 35 / 68 / 101 blank.
- [ ] 25 non-empty `LastConnectedRaw` values in the source at the 2026-10-21
  baseline (19 appeared in the old feed);
  parseable dates have `LastConnectedDate`, and every unparseable date is flagged.
- [ ] Non-empty Goal/Action/Project counts match the source tabs.
- [ ] 7 duplicate labels still exist as separate rows (not merged).
- [ ] `_migration_map` has 208 rows and every `NewRow` points at the right contact.

If any check fails: stop and inspect the copy and migration map. Never delete
target rows automatically; a partial write or a manual edit needs explicit
reconciliation. The source tabs are untouched.

### Step 5 — feed and History/Links

- Implemented staging projection: `crm-feed.gs`,
  `breadCrmRefreshFeedCopy()`; production IDs are forbidden. With the new write
  app in the same project and `CRM_FEED_ID` set, successful writes refresh the
  staging feed. A projection failure reports `ok:true, feedUpdated:false` so
  clients do not retry an already committed add.
- Rebuild the feed `Contacts` tab from `Contacts`, projecting the columns in
  §4.5 and excluding `Method`.
- Add `ContactID` to `History`; backfill rows by matching `Campaign + Contact`
  **only where exactly one contact row matches**. Leave ambiguous entries blank
  for manual review; History has no row ID today. Implemented in
  `breadCrmPrepareWriteSchemaCopy()` — it returns `historyBackfilled` /
  `unresolvedHistory` counts for the review step.
- Add ID columns to `Links` (no rows today). The same helper backfills each
  link side only when the legacy campaign+row maps to exactly one migrated
  contact and the recorded contact name agrees; anything else stays blank and
  is counted in `linkSidesBackfilled` for manual review.
- Keep the feed's Contacts gid unchanged.

### Step 6 — app cutover

**CRM dashboard** (`crm-dashboard.html`):

- `parseContacts` reads `ContactID`/`CampaignID`; `id` becomes the contact ID.
- `rowLink` points at the `Contacts` tab + row (use its gid).
- Campaign list, counts and filters come from `Campaigns` (`Active` by default,
  an "Archived" chip to include the rest).
- New ops: `contact.update`, `contact.mark`, `contact.add`,
  `contact.link`, `contact.unlink`.
- Campaign actions: **New campaign** (registry insert), **Archive/restore**.
  No "delete tab" anywhere.

**CRM write app** (new standalone [`crm-write.gs`](crm-write.gs), not deployed):

- User confirmed a new endpoint can be installed later; no need to retrieve
  the old endpoint source. Follow [`CRM-WRITES.md`](CRM-WRITES.md) for staging.
  The old dashboard's `WRITE_URL` points to a different script;
  `work-tracker-write.gs` handles only Work Tracker + Contributors.
- The replacement implements `contact.*` and `campaign.*` ops and rejects
  legacy row-based ops. Leave the old endpoint unchanged until the new
  dashboard and replacement endpoint switch together.
- `contact.update` accepts a whitelist: `Priority`, `Status`, `Owner`, `Goal`,
  `Type`, `Action`, `Project`, `Deliverable`, `LastConnected*`, `LocationMet`,
  `Method`, `Notes`. Never `ContactID`, `CampaignID`, `CreatedAt`.
- Every write sets `UpdatedAt`, appends `History` with `ContactID`, and
  replies `{ ok, contactId, changed }`.
- `campaign.create {name, owner, description, goal}` appends a registry row
  (slug uniqueness enforced). `campaign.archive` / `campaign.restore` only flip
  `Status`.
- Locks around every write; batch validation errors return `{ok:false}`.

### Step 7 — dry run on a copy

Do **not** run a week of dual writes. Build and validate against a copy of the
spreadsheet, then rehearse the switch:

- Make an editable copy of the CRM sheet, run the three copy-only functions in
  [`crm-migration.gs`](crm-migration.gs) against its ID, and compare the
  validation report with the live baseline. Do not pass the production ID.
- Point a staging copy of the feed and a `crm-v2.html` at it. No live writes.
- Compare totals, per-campaign counts, status/priority counts and 10 random
  records with the live dashboard.
- Test the full write path on a scratch contact: edit, mark, link, unlink,
  archive a campaign, restore it; verify History and that no contact disappears.
- Time the migration and feed rebuild so the live window is predictable.

### Step 8 — cutover (one short window)

1. Announce a 60–90 minute CRM write freeze.
2. Take fresh backups of **both** the production CRM and the feed. The
   copy-only guard in `crm-migration.gs` must not be removed for staging;
   production execution needs a separately reviewed cutover entry point.
   Migrate production only after the replacement CRM endpoint has passed the
   staging rehearsal.
3. Rebuild the feed, deploy the new dashboard and write app together.
4. Spot-check 10 records, then rename the old tabs `_legacy_<campaign>`.
5. Unfreeze. Keep the previous app deployment and `_legacy_*` tabs for 30 days
   as rollback.

There is no period where the old dashboard writes to old tabs while the new one
reads the new table — reads and writes flip together, which is why the freeze
is short and rehearsed.

### Step 9 — cleanup (after 30 days)

1. Delete `_legacy_*` tabs and the old write-app deployment.
2. Remove the legacy `update/mark/link/unlink/add` ops from the write app.
3. Drop the `_migration_map` tab (or keep it as an audit artefact).

## 7. Rollback

- Source tabs are never modified during steps 1–7.
- Rollback = **restore the old feed tab from its pre-cutover copy**, restore
  the old dashboard and write-app deployment, and restore the old tab names if
  they were renamed. The old dashboard cannot read a newly projected feed just
  by changing a constant. `Contacts`, `Campaigns` and the map can stay for a
  second attempt.
- The spreadsheet copy in step 0 is the last resort.

## 8. What changes for campaign lifecycle

| Action | Before | After |
|---|---|---|
| New campaign | copy a tab, fix headers, add to feed | insert a `Campaigns` row |
| Rename | rename tab + repair feed | edit `Campaign` label |
| Delete | delete tab → **contacts lost** | `Status = Archived`; rows untouched |
| Restore | impossible | flip `Status = Active` |
| Find a contact | remember the campaign tab | one searchable table |

## 9. Risks / decisions to confirm

1. **Row-per-relationship** is kept; duplicate people are not merged. Confirm
   before step 3.
2. **Method** stays out of the feed. The CRM sheet remains link-readable, as it
   is today; this migration does not widen exposure.
3. **Artizen** keeps `Type`; standard `Goal`/`Deliverable` are blank for those
   rows. Confirm that is the intended semantic.
4. **Blank status** stays blank (not rewritten to "Not contacted"), preserving
   current counts and UI behaviour.
5. The feed is **script-projected**, not formula-based, so `Method` can be
   excluded and the gid kept stable. If the feed is currently formula-built,
   the script replaces that formula.
6. `Devconnect 2025` must be resolved by tab name; its feed gid is `0`.

## 10. Order of work

1. Migration script + validation (steps 1–4) against a **copy** of the sheet.
2. Feed + History backfill (step 5).
3. Dashboard v2 + write-app ops (step 6).
4. Rehearse on the copy (step 7).
5. Cut over in one short window (step 8).
6. Then — and only then — campaign create/archive in HQ, and the final
   Apps Script consolidation pass.
