# CRM write endpoint (not deployed)

`crm-write.gs` is a **new, standalone** web app for the consolidated Contacts
model. It does not depend on the old CRM endpoint's source. Keep that endpoint
live until the new client, feed and write app can switch together.

## Install later — staging first

1. Migrate an editable CRM **copy** with `crm-migration.gs` and validate it.
2. Create a separate Apps Script project and add `crm-write.gs` and
   `crm-feed.gs` (optional until a staging feed copy is ready).
   Do not combine it with `work-tracker-write.gs`: both define `doPost`.
3. In **Project Settings → Script Properties**, set:
   - `CRM_SPREADSHEET_ID`: the staging copy's ID.
   - `CRM_WRITE_TOKEN`: a cryptographically random secret, at least 32 characters.
   - `CRM_FEED_ID`: the **separate feed copy's** ID, when projection is enabled.
   No secret or default spreadsheet ID is embedded in the code.
4. Run `breadCrmPrepareWriteSchemaCopy()` manually. This copy-only helper
   appends ID headers to legacy History/Links, preserving their column order
   and rows. Unique campaign+name History matches and verified legacy-row link
   sides are backfilled with the new ContactIDs; ambiguous matches stay blank
   and are counted in the returned report for manual review.
5. Deploy a web app, **Execute as: Me**, **Who has access: Anyone**. The owner
   must have edit access. Use the `/exec` URL only in the new staging client.
6. Run `breadCrmRefreshFeedCopy()` after configuring the feed copy; use its
   returned tab gids for the staging dashboard configuration. This preserves
   existing feed tab gids, exports only allowlisted columns and clears obsolete
   rows/columns. Method, Org and private Notes are excluded from Contacts.
   Speakers/Invites are left untouched (copy the old feed to retain them).
7. Test the operations below on synthetic staging contacts, then test campaign
   archive/restore and verify contact counts do not change.

Approved CRM staging copy supplied by the user:
[`1yt--g8XMWJxkkJMcodbbDxN_y7KVwgqdb3XmDbsEV_E`](https://docs.google.com/spreadsheets/d/1yt--g8XMWJxkkJMcodbbDxN_y7KVwgqdb3XmDbsEV_E/edit).
It has been opened in the browser, **not migrated or modified**. A separate feed
copy is still needed; never reuse the production feed as the staging destination.

The published CRM dashboard still sends legacy `update/mark/add/link/unlink`
operations. **Do not point it at this endpoint yet.** The editable source now
supports a consolidated mode behind the disabled `CRM_V2` configuration. The
new endpoint rejects legacy operations instead of guessing identity from rows.

## Dashboard staging configuration

In `decks-src/crm-dashboard/crm-dashboard.src.html`, set the explicit `CRM_V2`
configuration for a **staging build only**, using the projection's returned gids:

```js
const CRM_V2 = {
  enabled: true,
  feedId: "<separate feed copy ID>",
  sourceId: "1yt--g8XMWJxkkJMcodbbDxN_y7KVwgqdb3XmDbsEV_E",
  campaignsGid: "<Campaigns gid from projection report>",
  gids: {contacts: 0, links: 0, history: 0}, // replace ALL with actual feed gids
  writeUrl: "<new staging /exec URL>",
  writeToken: "<same secret as CRM_WRITE_TOKEN>"
};
```

The default source remains `enabled:false`; it preserves the old production
contract. When enabled, invalid/missing stable IDs, reordered headers or missing
registry references reject a refresh before it replaces the last valid state.
Empty campaigns come from the registry, not contact counts. Archived contacts
remain in memory, identities and profiles; the **Include archived campaigns**
toggle includes them in lists, desks, analytics, organizations and search.
**Manage campaigns** creates, archives and restores registry records only.

If retaining Speakers/Invites, use their copied tab gids (or `gids.speakers` /
`gids.invites` overrides). External grants and event tabs are optional in v2;
core Contacts/Campaigns/Links/History are mandatory.

Install both scripts in the same project to share the write lock. After a
successful write, a configured staging feed is refreshed automatically. A
projection failure returns `ok:true, feedUpdated:false` rather than encouraging
a duplicate write; rerun `breadCrmRefreshFeedCopy()` to reconcile. Staging
helpers reject known production IDs. Production entry points
(`breadCrmRefreshFeedProduction()` etc.) exist but require the explicit
environment/cutover flags and separate backups described in
[`SUITE-DEPLOYMENT.md`](SUITE-DEPLOYMENT.md) §7.

## Contract

POST `text/plain;charset=utf-8`, JSON with `token`, `op`, optional `by`:

```jsonc
{ "token": "…", "op": "contact.update", "contactId": "c_…",
  "patch": { "Owner": "Josh", "Priority": "High" } }
{ "token": "…", "op": "contact.mark", "contactId": "c_…" }
{ "token": "…", "op": "contact.add", "campaignId": "stacks",
  "fields": { "Contact": "Example", "Status": "Not contacted" } }
{ "token": "…", "op": "contact.link", "leftId": "c_…",
  "rightId": "c_…", "type": "bridge", "note": "Optional note" }
{ "token": "…", "op": "contact.unlink", "leftId": "c_…",
  "rightId": "c_…", "type": "bridge" }
{ "token": "…", "op": "campaign.create", "name": "New campaign",
  "owner": "Josh", "description": "…", "goal": "…" }
{ "token": "…", "op": "campaign.archive", "campaignId": "new-campaign" }
{ "token": "…", "op": "campaign.restore", "campaignId": "new-campaign" }
```

- Replies contain `ok`, IDs and `changed`, or `ok:false` and a generic error.
  HTTP success does not imply `ok:true`; clients must check the JSON.
- `contact.mark` sets Status to Contacted and both last-connected fields to
  today's UTC date. Normal updates validate ISO dates but do not infer dates
  from raw text; callers should send both fields when changing them.
- Writable fields: Org, Priority, Status, Goal, Type, Owner, Action, Project,
  Deliverable, LastConnectedRaw, LastConnectedDate, LocationMet, Method, Notes.
  `Contact` is accepted on add only; IDs, timestamps and campaign membership
  are not editable through a patch.
- Unknown fields, invalid statuses/priorities and invalid dates reject the
  whole patch before any contact write. ID lookup is exact and rejects
  ambiguous duplicates. Row numbers are not accepted as identity.
- Campaign deletion is not exposed. Archive/restore only change registry
  metadata; existing contact records remain editable and are never removed.
  Adding to an archived campaign is rejected.
- Links are undirected **per type**, idempotent on repeated link/unlink, and
  use appended LeftContactID/RightContactID columns. Legacy ID-less links are
  backfilled by `breadCrmPrepareWriteSchemaCopy()` where the legacy campaign+row
  (and contact-name check) identifies exactly one contact; anything else is left
  blank and reported for manual review before the new client can unlink it.
- A script lock serializes writes. Sheets operations are **not transactional**:
  a service failure may leave a data write without its audit row. Reconcile
  against the staging/production sheet before retrying `contact.add` or
  `campaign.create`; those operations have no request-id deduplication.
- History records IDs and field names, not changed field values, so Method and
  private Notes do not leak through an exported History projection.
- The token is a shared secret, not per-person authentication; `by` is
  caller-supplied. Anyone with the token has all supported write permissions.

Local checks:

- `node apps-script/tests/crm-migration-harness.cjs` — copy migration, endpoint,
  feed privacy, stale-cell cleanup, gid preservation and post-write projection.
- `node apps-script/tests/crm-dashboard-harness.cjs` — both client contracts,
  stable-ID identities, archive visibility, strict headers and edit rollback.
- `node apps-script/tests/crm-preview-server.cjs` — synthetic browser preview
  on `http://127.0.0.1:8766`, with mocked reads/writes (never real Sheets).

No Google deployment or real-sheet migration run has been performed. Browser
checks use synthetic data, including archive retention and new empty campaigns.

## Still needed before production

Real-copy migration/rehearsal, staging deployment and encrypted staging build,
verification against real sheet data, then a backed-up production cutover.
Do not rerun migration on a target after endpoint writes: its conflict
guard deliberately refuses to overwrite edited imported cells.
