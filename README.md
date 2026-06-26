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
