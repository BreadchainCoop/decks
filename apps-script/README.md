# Work Tracker write-back

`work-tracker-write.gs` is the Google Apps Script web app that lets
[`work-tracker.html`](../work-tracker.html) write to the Work Tracker sheet
instead of copying "Breadrich, …" commands.

It is optional: the deck runs in copy-command mode until `WRITE_URL` is set.

- Sheet: **Work Tracker** — `10vQRSVpiePANd1yNzSyua_PO5DCgk9muB_VqYIFDAkE`
- Writes to the `Tasks` tab, logs every change to the `History` tab
- Auto-creates any missing task columns on first write

## Deploy

1. Open the Work Tracker sheet → **Extensions → Apps Script**.
2. Replace `Code.gs` with the contents of `work-tracker-write.gs`.
3. Set `TOKEN` to a long random string (and leave `SPREADSHEET_ID` as is).
4. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Copy the **`/exec` URL**.

> "Anyone" is required so the static page can reach it. The `TOKEN` is what
> actually authorises writes — treat it as a shared secret and don't commit it
> to a public place.

## Wire it into the deck

In `work-tracker.html` (inside the encrypted payload — ask a maintainer with the
deck password, or edit the plaintext source):

```js
const WRITE_URL = "https://script.google.com/macros/s/…/exec";
const WRITE_TOKEN = "…";
```

Re-encrypt and redeploy. The footer and the How It Works page then read
"edits write straight to the sheet".

If a write fails, the deck reverts the optimistic change and copies a Breadrich
command instead — so nothing is silently lost.

## Contract

`POST`, `Content-Type: text/plain;charset=utf-8`, JSON body:

```jsonc
// change fields on an existing task
{ "token": "…", "op": "update", "row": 12, "task": "Follow up on NGI…",
  "patch": { "Status": "Review", "Owner": "Unai" } }

// append a task
{ "token": "…", "op": "add",
  "fields": { "Task": "…", "Project": "Grants", "Status": "Backlog" } }
```

Response: `{ "ok": true, … }` or `{ "ok": false, "error": "…" }`.

Only the headers in `REQUIRED_HEADERS` are writable; unknown keys are ignored
and reported back in `changed`.
