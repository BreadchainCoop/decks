# Write-back web app (Work Tracker + Contributors)

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

`drafts/` holds the mechanical jobs that are being consolidated separately
(GitHub → Tasks sync, grants intake/hygiene/discovery). They are not part of
this endpoint yet.

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
