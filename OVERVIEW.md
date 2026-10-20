# Breadrich Suite — system brief

The co-op's internal tooling: Bread HQ plus four static dashboards over Google
Sheets, a consolidated write-back web app, and scheduled automations. This document is
the map — what talks to what, where the tokens go, and which work must never be
done by a model.

Related: [`README.md`](README.md) (repo + deck rules),
[`apps-script/README.md`](apps-script/README.md) (deployment),
[`contributor-pipeline/`](contributor-pipeline/README.md) (signup watcher).

**Release status:** HQ/CRM features, consolidated Apps Script bundle and seven
local harnesses are implemented. Google setup, staging deployment and encrypted
publication are still pending. The current live sheets/decks have not changed.
The complete release checklist is
[`apps-script/SUITE-DEPLOYMENT.md`](apps-script/SUITE-DEPLOYMENT.md).

## 1. Design rules

1. **The sheets are the database.** Every tool is a lens or a writer; nothing
   owns a second copy of the truth.
2. **Mechanical work belongs in code.** Syncing, deduping, status transitions,
   date arithmetic, link checks, reminders and file creation are triggers, not
   prompts. The model is for judgment: drafting, fit, prioritisation, tone.
3. **Script-gated.** A job runs on a schedule, compares what it sees to a small
   cursor, and **exits silently when nothing changed**. Silence is the normal
   output. (Model: `contributor-pipeline/watch.cjs`.)
4. **One event inbox for the agent.** Jobs append compact events; Breadrich
   reads only unhandled rows. No events ⇒ no model call, no tokens.
5. **One write app, namespaced ops.** One URL, one token, ops like
   `work.update`, `crm.mark`, `contributor.assign`, `grants.stage`. Dashboards
   never hold sheet credentials.
6. **Nothing is silently lost.** If a write fails, the deck reverts and copies a
   `Breadrich, …` command instead.
7. **Everything gated.** Pages are StatiCrypt-encrypted with a shared salt; the
   password is shared out of band. PII stays out of git.
8. **Deterministic first.** If a step can be specified exactly, it does not get
   a prompt.

## 2. Surfaces

| Surface | Reads | Writes | Notes |
|---|---|---|---|
| `index.html` (HQ build, not published) | authenticated HQ records + aggregate budget scenario | resources/time off; committee-only directives | master document remains authoritative |
| `work-tracker.html` | Work Tracker Tasks + History, Grants targets | Work Tasks via write app | copy-command fallback |
| `grant-dashboard.html` | Grants dashboard feed (targets + stats) | — (commands only today) | 8-stage pipeline, 100-target goal |
| `crm-dashboard.html` | CRM tabs + campaign feed, Grants targets | CRM sheet via deployed web app | ops: update / mark / link / unlink / add |
| `contributor-dashboard.html` | Interest form live tab, Work Tasks | Interest form + Work Tasks | assignment upserts an outreach task |
| `apps-script/dist/Code.gs` (generated) | all configured suite sheets | namespaced router + Agent Inbox | one deployable bundle, not installed |
| `apps-script/work-tracker-write.gs` | Work Tasks/History, Interest form | both sheets | retained standalone compatibility module |
| `contributor-pipeline/watch.cjs` | Interest form (public gviz) | `state.json` only | daily gate, prints `{wakeAgent}` |
| `apps-script/drafts/gh-sync.gs` | GitHub org, Work Tasks | Work Tasks + History | hourly, untested draft |
| `apps-script/drafts/grant-tracker.gs` | Grants tracker | Grants tracker + Drive + email | intake / hygiene / discovery, untested draft |

## 3. Sheets in scope

| Sheet | ID | Tabs used | Consumers |
|---|---|---|---|
| **Work Tracker** | `10vQRSVpiePANd1yNzSyua_PO5DCgk9muB_VqYIFDAkE` | `Tasks` (648305052), `History` (435294969) | work deck, write app, gh-sync |
| **Grants dashboard feed** | `1OmGfZO9BUhNFY1JEiIkRWY9eEnvW7x3fTtckXeqLa-Q` | `Targets` (1390971359), `Stats` (529138043) | grant deck, CRM, work deck |
| **Grants tracker** | `1Rm_rucOcAbcJTHQG7U84xFOi0fw3ZM2jT9M8R_adwME` | `Grants`, `Start a Grant` (header row 3); new `Discovery Inbox` after setup/run | configured grants writer/jobs |
| **CRM source** | `1c4PgSHC2N2n7VsFHhYH0PMvtQljvZg-ZQo6MtOojVYY` | currently ten campaign tabs; target `Contacts` + `Campaigns` after migration | CRM writer/migration |
| **CRM dashboard feed** | `19Lxe0C14BOYbOj0Z0nyoQc4-I_aw_jgybcq9LggfcUw` | `Contacts` (1045890393), `Speakers` (566499254), `Invites` (1587498794), `Links` (1360104050), `History` (1664679355); new `Campaigns` after projection | CRM deck |
| **Contributor Interest Form** | `1ncGbPZyf0vH9NCsndvaUkmkJremWz1YW1_-YPpLRjxA` | `New Form Responses 25 Sept 2025` | contributor deck, watcher, write app |
| **Bread HQ** (new, not initialized) | `1olxp1zTy14eaY1yfTuDhqsWP1FnktxShgVXQamErplY` | Resources, Directives, TimeOff, History after owner-run setup | HQ + suite writer |
| **CRM staging copy** | `1yt--g8XMWJxkkJMcodbbDxN_y7KVwgqdb3XmDbsEV_E` | ten copied campaign tabs; 208 contacts verified read-only | rehearsal, not migrated |

HQ also links the authoritative strategic-directives document
`1NsvX9b544yW8Bj8ZvozowrAqZ3dbgvClvy-9r9VT3dU` and reads aggregate-only
scenario cells from the supplied budget calculator
`1iWZXv2yaquz_oRlYGCn0jhJYsVuseea6e0aE2EpYsx8` (gid `1139000984`).
Neither is replaced or edited. Draft approval and scenario labels are preserved.

`weekly-facilitators.html` is a slideshow, not a sheet-driven tool. Older decks
(`weekly-facilitators`, `epub-…`) currently use a **different deck password**;
only the four dashboards share the SSO salt.

## 4. Automations

### 4.1 Job matrix

| Job | Trigger | Reads | Writes | Status |
|---|---|---|---|---|
| GitHub → Tasks | hourly, explicitly enabled | member PRs/reviews/issues | proposal inbox; bounded managed-task writes only in apply mode | hardened + tested, not deployed |
| Grant intake | daily 08:45 | `Start a Grant` | proposal inbox; exact-match row + recoverable doc creation only in apply mode | hardened + tested, no email |
| Grant hygiene | Mon 08:15 | Grants links/actions | Agent Inbox, no source edits | built + tested; rotating bounded link checks |
| Grant discovery | Wed 08:25 | 8 sources | Discovery Inbox + Agent Inbox | built + tested; silent baseline, no email |
| **Work hygiene** | daily 09:00 | Tasks, History | Agent Inbox digest | built + harness-tested, not deployed |
| **CRM follow-ups** | daily 09:15 | CRM tabs, History | Agent Inbox digest | built + harness-tested, not deployed |
| **Contributor gate** | daily 09:30 | Interest form | Agent Inbox event | built + harness-tested; node watcher still live |
| **Weekly rollup** | Mon 08:00 | four domain sheets | Agent Inbox when totals change | built + tested, not deployed |
| **Form → inbox** | on submit | Interest form | same gate/cursor as daily job | built + tested, not deployed |
| **HQ date boundaries** | daily 08:10 | TimeOff, Published directives | Agent Inbox when active sets change | built + tested, not deployed |

### 4.2 Job anatomy

Every job is the same shape:

```
lock → read cursor → read only the relevant rows/links → diff
     → if nothing new: exit (no email, no event, no model)
     → write deterministic changes / append ONE compact inbox event
     → update cursor
```

Rules that keep it cheap and safe:

- **Idempotent**: rerunning a job never duplicates a row (markers, tombstones,
  or cursors).
- **Flag-only where a human decides**: hygiene jobs report, they do not delete
  or move.
- **Bounded**: a job caps its own writes per run and logs what it skipped.
- **Locked**: `LockService` around every write path.

### 4.3 Agent Inbox

A single tab — proposed home: Work Tracker (`Agent Inbox`) — so every consumer
can reach it.

| Column | Meaning |
|---|---|
| `Timestamp` | when the event was produced |
| `Source` | `work`, `crm`, `grants`, `contributors`, `github` |
| `Kind` | `needs-attention`, `new-signup`, `grant-flagged`, `weekly-rollup`, … |
| `Severity` | `info` / `warn` / `action` |
| `Ref` | stable handle (task row, contact id, funder, signup date+name) |
| `Summary` | one line a human can read in the sheet |
| `Payload` | compact JSON for the agent (no PII beyond what the sheet has) |
| `Handled` | blank = unread; set by the agent/bot when acted on |

The agent reads `Handled = ""`, handles the batch, then marks rows handled. No
unhandled rows = no call. This replaces per-job chat pings with one queue.

### 4.4 What stays with the model

- Grant fit judgment and application drafting.
- Outreach copy and tone (the dashboard drafts a starting point; a human sends).
- Prioritisation where the data is ambiguous.
- Summaries and anything requiring reading free text.
- Final review before any external send or publish.

Everything else is scripted.

## 5. Write app contract (target)

One deployment, token-gated, `<domain>.<op>`:

```jsonc
{ "token":"…", "op":"work.update",  "row":12, "task":"Exact title", "patch":{ "Status":"Review" } }
{ "token":"…", "op":"work.add",     "fields":{ "Task":"…", "Project":"Grants" } }
{ "token":"…", "op":"contributor.assign", "signupRow":43, "name":"…",
  "timestampMs":0, "owner":"Unai", "task":{ … } }
{ "token":"…", "op":"crm.update",   "contactId":"c_…",
  "patch":{ "Status":"Contacted" } }
{ "token":"…", "op":"crm.mark",     "contactId":"c_…" }
{ "token":"…", "op":"crm.link",     "type":"org", "leftId":"c_…", "rightId":"c_…" }
{ "token":"…", "op":"grants.stage", "funder":"…", "stage":"Drafting" }
{ "token":"…", "op":"hq.read" }
```

The locally built `dist/Code.gs` serves all domains, including HQ. Existing
deployed apps and encrypted dashboards still use their prior contracts until
cutover. Legacy Work `update`/`add` remain accepted; legacy CRM row packets
deliberately reject at the new router, rather than risk writing a Work row.
The replacement CRM module was built locally instead of retrieving the old
deployed source. Production defaults are never inferred in the consolidated build.

## 6. Token budget

| Today | After |
|---|---|
| Agent asked to sync GitHub, chase dead grant links, move rows, notice stale contacts, remind owners | Triggers do it; agent reads one digest |
| Per-task chat touches | Batched inbox rows |
| Polling with an LLM | Cursors in `ScriptProperties`; no-op runs cost nothing |

Target: **zero model calls on a quiet day**. The only daily calls should be
"read new inbox rows and decide" — and none at all when the inbox is empty.

## 7. Deployment & permissions

- The write app runs **as its deployer**; that account needs **edit** access to
  every sheet it writes (Work Tracker, Interest Form, CRM, Grants tracker).
- If one account cannot hold all four, keep per-sheet bound scripts and share
  only the helper library; the web app can stay single by opening each
  spreadsheet by ID.
- Google credentials, GitHub PATs and server secrets live in **Script
  Properties**, never public source. The member bearer token is necessarily
  available to an unlocked browser; release builds inject it in memory into
  the encrypted payload. The separate committee token is never embedded.
- Triggers are installed once by a `installTriggers()` function, and listed in
  `apps-script/README.md` so they can be audited.

## 8. Migration plan

This is the agreed implementation order. The code is now built through step 7;
the staged Google rehearsal and production rollout remain outstanding. Use
`apps-script/SUITE-DEPLOYMENT.md` for the current executable release checklist.

1. **Foundations** — shared `lib.gs` (JSON, token, header map, row find, lock,
   inbox append) + `Agent Inbox` tab + `installTriggers()`.
2. **Port, don't rewrite** — move `work-tracker-write.gs` ops to the router
   unchanged; keep the old file deployable until verified.
3. **Harden the drafts** — test `gh-sync.gs` and `grant-tracker.gs` against a
   copy of the sheets, then enable their triggers.
4. **Add the missing jobs** — work hygiene, CRM follow-ups, contributor gate,
   weekly rollup; each starts in **dry-run** (inbox only) before it writes.
5. **Retire** the node watcher and the separate CRM web app once their
   replacements are live for a week.
6. **Bread HQ + campaign lifecycle** — consolidate CRM contacts into one table
   first (spec: [`apps-script/MIGRATION-CRM.md`](apps-script/MIGRATION-CRM.md)),
   then the campaign registry, create/archive, directives, resources and time
   off. With one Contacts table, deleting a campaign is metadata and never
   touches a contact.
7. **Consolidate the Apps Scripts — once, last.** After the surfaces stop
   moving:
   - one project, one web app URL, one token, ops namespaced per domain;
   - every op covered by the Node harness, then exercised against a staging
     copy of each sheet before the live one;
   - `drafts/`, the separate CRM app and the node watcher retired only after a
     week of matching output;
   - triggers audited (owner, timezone, frequency) and listed in the README;
   - all four dashboards pointed at the one endpoint and re-encrypted with the
     shared salt.

   Done means: a quiet day produces zero model calls, one inbox check covers
   every sheet, and no dashboard holds a credential or a second copy of logic.

## 9. Open questions

- The installable form trigger and daily fallback now use one gate/cursor;
  retain the node watcher until staged outputs match for a week.
- Agent Inbox is in the configured Work Tracker. Breadrich's live consumer
  still needs a non-LLM poller to wake the model only for unhandled rows; the
  scripts themselves never invoke a model or send external messages.
- The linked directives section was still Draft when inspected. Who records
  its eventual approval remains a committee decision, not a script inference.
- The budget panel preserves the linked scenario's period label. Selecting or
  endorsing a different/current scenario is a human financial decision.
- Are there Excel/Sheets documents outside this suite that should join the
  matrix? Add them to §3 before building.
