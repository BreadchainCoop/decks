# contributor-pipeline

Tooling behind Bread Cooperative's contributor pipeline: the interest form →
signup watcher → outreach flow. Part of the Breadrich Suite (this repo) — the
matching `contributor-dashboard.html` lives at the repo root next to the other
dashboards. Maintained by Breadrich Engels (the co-op's assistant bot) with
contributions via PR.

## What's here

| File | Purpose |
|------|---------|
| `watch.cjs` | Daily script-gate watcher. Prints `{wakeAgent, data}` — quiet unless a new signup lands. Zero LLM cost when nothing changed. |
| `fetch-dump.cjs` | One-off helper: dumps both form tabs (legacy + live) to `raw-*.json` for inspection. |

## How the watcher works

- Reads the interest-form Google Sheet through the **public gviz feed** (no auth).
- Watches **only the live tab** `New Form Responses 25 Sept 2025` (the legacy
  `Form Responses 1` tab stopped receiving signups in Sept 2025 — ignored).
- A "real signup" = row with a non-empty **name** (col B) and a `Date(...)`
  **timestamp** (col A). This skips marker/annotation rows.
- Compares the count of real rows to `state.json` (`{"count": N}`) and wakes the
  agent only when it **grows**, passing the new rows. First run is a silent
  baseline. `state.json` is written every run.
- ~12s watchdog; on any fetch/parse failure it prints `wakeAgent:false` and
  skips the run (never wakes on errors).

## Deploy contract

A daily cron task runs `node watch.cjs`. Stdout's last line must be a single
JSON object:

- `{"wakeAgent": false, ...}` → nothing happens (the normal case).
- `{"wakeAgent": true, "data": {"newSignups": [...], "total": N}}` → the agent
  wakes and handles outreach (welcome DM from the outreach template, then the
  row's **Status** col C is set to `Contacted`).

**Not yet deployed**: cadence/owner/flow still to be decided — that's the open work.

## Sheet column map (live tab)

`A` timestamp · `B` name · `C` status (`Contacted` workflow) · `D` contact person in BC core ·
`E` Discord handle · `F` email · `G` preferred contact · `H` weekly hours · `I` governance interest ·
`J` software skills · `K` non-software skills · `L` dev skills wanted · `M` capacity ·
`N` experience · `O` programming background · `P` GitHub/portfolio · `S–V` team eval
(Value aligned / Skills needed / Vibe / Reliability / Others)

## What deliberately stays OUT of this repo

Contains personal data, so it never gets committed — it lives only in the bot
workspace:

- `state.json` (watcher cursor)
- `raw-active.json` / `raw-legacy.json` (full form dumps)
- `contributors/signups-db.md` (all 42 signups with emails/handles)
- The sheet ID *does* appear in the code here — house practice, same as the
  dashboards at the repo root. The sheet itself is link-readable, so keep data
  out of git and StatiCrypt-encrypt any dashboard that renders contributor rows
  before it lands here.
