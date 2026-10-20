# Breadrich Suite — system brief

The co-op's internal tooling: four static dashboards over Google Sheets, one
write-back web app, and a growing set of scheduled automations. This document is
the map — what talks to what, where the tokens go, and which work must never be
done by a model.

Related: [`README.md`](README.md) (repo + deck rules),
[`apps-script/README.md`](apps-script/README.md) (deployment),
[`contributor-pipeline/`](contributor-pipeline/README.md) (signup watcher).

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
| `work-tracker.html` | Work Tracker Tasks + History, Grants targets | Work Tasks via write app | copy-command fallback |
| `grant-dashboard.html` | Grants dashboard feed (targets + stats) | — (commands only today) | 8-stage pipeline, 100-target goal |
| `crm-dashboard.html` | CRM tabs + campaign feed, Grants targets | CRM sheet via deployed web app | ops: update / mark / link / unlink / add |
| `contributor-dashboard.html` | Interest form live tab, Work Tasks | Interest form + Work Tasks | assignment upserts an outreach task |
| `apps-script/work-tracker-write.gs` | Work Tasks/History, Interest form | both sheets | one deployment for two decks |
| `contributor-pipeline/watch.cjs` | Interest form (public gviz) | `state.json` only | daily gate, prints `{wakeAgent}` |
| `apps-script/drafts/gh-sync.gs` | GitHub org, Work Tasks | Work Tasks + History | hourly, untested draft |
| `apps-script/drafts/grant-tracker.gs` | Grants tracker | Grants tracker + Drive + email | intake / hygiene / discovery, untested draft |

## 3. Sheets in scope

| Sheet | ID | Tabs used | Consumers |
|---|---|---|---|
| **Work Tracker** | `10vQRSVpiePANd1yNzSyua_PO5DCgk9muB_VqYIFDAkE` | `Tasks` (648305052), `History` (435294969) | work deck, write app, gh-sync |
| **Grants dashboard feed** | `1OmGfZO9BUhNFY1JEiIkRWY9eEnvW7x3fTtckXeqLa-Q` | `Targets` (1390971359), `Stats` (529138043) | grant deck, CRM, work deck |
| **Grants tracker** (bound script) | *active sheet* — not hard-coded | `Grants`, `Start a Grant`, `Discovery inbox` | grant-tracker draft |
| **CRM** | `1c4PgSHC2N2n7VsFHhYH0PMvtQljvZg-ZQo6MtOojVYY` | `Contacts` (1045890393), `Speakers` (566499254), `Invites` (1587498794), `Links` (1360104050), `History` (1664679355) | CRM deck, CRM web app |
| **CRM campaign feed** | `19Lxe0C14BOYbOj0Z0nyoQc4-I_aw_jgybcq9LggfcUw` | campaign tabs | CRM deck |
| **Contributor Interest Form** | `1ncGbPZyf0vH9NCsndvaUkmkJremWz1YW1_-YPpLRjxA` | `New Form Responses 25 Sept 2025` | contributor deck, watcher, write app |

`weekly-facilitators.html` is a slideshow, not a sheet-driven tool. Older decks
(`weekly-facilitators`, `epub-…`) currently use a **different deck password**;
only the four dashboards share the SSO salt.

## 4. Automations

### 4.1 Job matrix

| Job | Trigger | Reads | Writes | Status |
|---|---|---|---|---|
| GitHub → Tasks | hourly | GitHub org PRs/issues | Tasks + History | draft port (`drafts/gh-sync.gs`) |
| Grant intake | daily 08:45 | `Start a Grant` | Grants row, Master doc, email | draft (`drafts/grant-tracker.gs`) |
| Grant hygiene | Mon 08:15 | Grants links/actions | flags only (no moves) | draft |
| Grant discovery | Wed 08:25 | 8 sources | `Discovery inbox` + email | draft |
| **Work hygiene** | daily 09:00 | Tasks, History | Agent Inbox digest | built + harness-tested, not deployed |
| **CRM follow-ups** | daily 09:15 | CRM tabs, History | Agent Inbox digest | built + harness-tested, not deployed |
| **Contributor gate** | daily 09:30 | Interest form | Agent Inbox event | built + harness-tested; node watcher still live |
| **Weekly rollup** | Mon 08:00 | all sheets | Agent Inbox | to build |
| **Form → inbox** | on submit | Interest form | Agent Inbox | to build |

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
{ "token":"…", "op":"work.update",  "row":12, "patch":{ "Status":"Review" } }
{ "token":"…", "op":"work.add",     "fields":{ "Task":"…", "Project":"Grants" } }
{ "token":"…", "op":"contributor.assign", "signupRow":43, "name":"…",
  "timestampMs":0, "owner":"Unai", "task":{ … } }
{ "token":"…", "op":"crm.update",   "campaign":"…", "row":8,
  "patch":{ "Status":"Contacted" } }
{ "token":"…", "op":"crm.mark",     "campaign":"…", "row":8 }
{ "token":"…", "op":"crm.link",     "type":"org", "left":{…}, "right":{…} }
{ "token":"…", "op":"grants.stage", "funder":"…", "stage":"Drafting" }
```

Today `work-tracker-write.gs` serves `work.*` (old names `update`/`add`) and
`contributor.*`. CRM has its own deployed app (Gilberto, 2026-10-14) whose
source is not in this repo. Grants has no write path yet. Consolidation means
moving all four domains behind this one contract without breaking the old ops.

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
- Secrets (`TOKEN`, webhook URLs, GitHub PAT) live in **Script Properties**,
  never in this repo or the decks.
- Triggers are installed once by a `installTriggers()` function, and listed in
  `apps-script/README.md` so they can be audited.

## 8. Migration plan

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
6. **Bread HQ + campaign lifecycle** — the front door (`index.html`), campaign
   registry, create/archive without touching contacts, directives, resources
   and time off. Campaign deletion starts as **archive**; consolidating contacts
   into one table (so deletion is metadata) is the later, bigger migration.
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

- Is the contributor gate better as an `onFormSubmit` trigger than the daily
  node watcher? (Trigger would be instant and token-free; the watcher exists
  because the bot workspace may not hold the form's script.)
- Which sheet should host `Agent Inbox` — Work Tracker is the natural home, but
  the grants script is bound to the grants tracker.
- Does Breadrich read a sheet, a Discord webhook, or email? The inbox design
  works for all three but the hand-off needs picking.
- Are there Excel/Sheets documents outside this suite that should join the
  matrix? Add them to §3 before building.
