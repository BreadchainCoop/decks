# decks

Statically-hosted **Breadrich Engels** debrief slideshows, served via GitHub
Pages at `https://breadchaincoop.github.io/decks/<name>.html`.

## ⚠️ Always statically-encrypt every deck before pushing

Decks are **password-gated** with [StatiCrypt](https://github.com/robinmoisson/staticrypt)
(client-side AES; no server). **Never commit an unencrypted deck** — the live
Pages URL is public, so an un-encrypted file would be readable by anyone with
the link.

The viewing **password is shared with the team out-of-band** (pinned in
`#breadrich-engels`) — **do not commit the password to this repo**, that would
defeat the encryption.

## Add a deck

1. Build the slideshow as a single self-contained `deck.html` (inline CSS/JS,
   keyboard + click nav — see the existing decks for the house format).
2. Encrypt it:
   ```bash
   npx staticrypt deck.html -p '<team-password>' --short -d out
   # → out/deck.html  (this is the file you publish)
   ```
3. Rename to a descriptive slug and commit **only the encrypted file**:
   ```bash
   mv out/deck.html my-topic.html
   git add my-topic.html && git commit -m "Add <topic> deck" && git push
   ```
4. Share `https://breadchaincoop.github.io/decks/my-topic.html` + the password
   in the channel.

## House rules

- Encrypted files only. If a plaintext deck ever lands here, **rewrite history**
  (`git checkout --orphan` → fresh commit → force-push) so it isn't recoverable.
- One self-contained `.html` per deck. No build step; Pages serves the file
  directly.
- The `slideshow-deck` container skill automates make → encrypt → publish.

## Live dashboards

`work-tracker.html`, `grant-dashboard.html` and `crm-dashboard.html` are
interactive dashboards rather than slideshows, but follow the same rules —
StatiCrypt-encrypted before pushing, one self-contained file each.

They share one shell: sidebar nav, command palette (`Ctrl/⌘ K`), a slide-over
record panel, `j`/`k` row cursor, and a live/snapshot sync indicator.

`work-tracker.html` reads the **Work Tracker** sheet
(`10vQRSVpiePANd1yNzSyua_PO5DCgk9muB_VqYIFDAkE`) and, when a write endpoint is
configured, writes back through an Apps Script web app — see
[`apps-script/`](apps-script/README.md).

The Tasks tab carries three extra columns for the v2 features:
`Blocked by` (task numbers, drives blocker chains + cycle detection),
`Subtasks` (`[x] done | [ ] open`) and `Start` (optional, gives the timeline
true spans). The Apps Script creates them automatically on first write.

