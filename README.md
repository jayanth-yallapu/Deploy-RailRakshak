# RAIL RAKSHAK

**AI-Powered Automatic Block Planning to Maximize Asset Availability on Indian Railways**
Smart India Hackathon 2026 · Problem Statement #26027 · Ministry of Railways · Transportation & Logistics

RAIL RAKSHAK replaces the decentralized, manual BDMS block-planning process with a data-driven,
coordinated system: it ingests defects from TMS/TDMS/SMMS, predicts failure risk with a **trained**
model, bundles Engineering + Traction + S&T into single-occupancy **super-blocks**, and runs the
whole 5-step field workflow from patroller photo to inspector sign-off and block release.

---

## Quick start

```bash
cp .env.example .env        # set DATABASE_URL
npm install
npx drizzle-kit push        # create tables
npm run build && npm start  # or: npm run dev
```

Open `http://localhost:3000` → sign in via `/login` (4 demo roles). The Delhi-NCR grid, assets,
defect backlog, workflow jobs and an opening block plan **auto-seed on first request** (idempotent,
self-healing, serialised across processes with a Postgres advisory lock).

### Evidence, not adjectives

Three endpoints exist so the claims on the landing page can be re-derived by anyone in the room:

```bash
curl -s -X POST localhost:3000/api/benchmark -H 'content-type: application/json' -d '{"runs":100,"seed":1}'
curl -s localhost:3000/api/policy | head -c 400
curl -s "localhost:3000/api/explain?blockItemId=<id-from-/api/state>"
```

- **`/api/benchmark`** runs the *same* `planPool` the product uses against a process model of a
  divisional allocation meeting (department-silo lists in arrival order, one occupation per
  department, habitual mid-window start, 8–20 % duration padding, one gang per department per night,
  double-bookings resolved by pushing to the next night) on the same backlog, under the same physical
  constraints, scored by the same objective function. It reports a bootstrap 95 % interval on the
  paired deltas and lists every assumption it made. Measured on the seeded grid: 76.0 vs 115.2
  block-minutes per defect cleared, 43 vs 31 defects cleared per cycle, +1815 train-minutes of
  avoidable delay (CI +1732…+1894), AI at least as good on every metric in 100 % of runs.
- **`/api/policy`** evaluates the block rule book (nine rules, each quoting the clause it enforces)
  over the *stored* plan, so a plan that has been dragged, or that a VVIP/fog notification has just
  invalidated, cannot still read as clean. `POST /api/veto {mode:"APPROVED"}` returns 409 while any
  hard rule is breached; approval is only possible after the fix or with a recorded override reason.
- **`/api/explain`** returns the audit note the solver wrote for a block: the objective terms of the
  defect that drove it, the slot taken, the best rejected slot with its gap measured on the same
  scale, that night's remaining occupancy budget, and the bundling saving. A block a human moved
  says so explicitly instead of having its reasoning rewritten.

All three are read-only with respect to a published plan (verify asserts this), and the benchmark
never writes to `plans`/`block_items`, so running them mid-demo cannot disturb the schedule on screen.

### Verifying a deployment

Four gates, all runnable against any URL. These are the checks we re-run after every change —
"the build passes" is not one of them, it is the *minimum*:

```bash
npx tsc --noEmit                        # 0 errors (a schema change that strands a consumer fails here)
npm run build                           # must succeed with NO network access (fonts are self-hosted)
node scripts/verify.mjs  http://localhost:3000   # 57 business-invariant checks against live APIs
node scripts/smoke.mjs   http://localhost:3000   # 19 checks: every page renders its own component
                                                 # tree, every endpoint returns shaped data, and the
                                                 # data lake is actually populated
```

Reset the demo state at any time (each optimiser run allocates backlog, so a reset keeps a booth
demo repeatable and makes `verify.mjs` deterministic):

```bash
curl -X POST http://localhost:3000/api/seed -H 'content-type: application/json' -d '{"force":true}'
```

## Roles & pages

| Role | Entry | What they see |
| --- | --- | --- |
| DRM / Admin | `/command`, `/planner` | health index, trust index, financials, plan approval, reasoned human veto |
| Control Room (COA) | `/command`, `/simulation` | NTES live board, what-if cascade lab, overrun pre-emption, draggable Gantt, Final-Boss 60 s crisis |
| Section Inspector | `/field` | beat-focused map, patroller inbox, crew allotment (AI-recommended), before/after sign-off with fraud checks |
| Maintenance Karmi | `/jobs` | GenAI job permits, GPS proximity gate, before/after photo capture, offline queue, auto-escalation |
| Track Patroller | `/patrol` | phone-framed defect reporting with GPS lock (feeds Step 0) |

## Architecture

```
TMS · TDMS · SMMS · COA · FOIS · IMD          (contracts: src/lib/integrations/contracts.ts)
        └─ federated data lake (PostgreSQL via Drizzle ORM)
                 │
   ml.ts        → logistic-regression risk model (batch GD, L2, 500 epochs,
                 fitted in-process on 2,400 labeled work-order outcomes,
                 80/20 holdout accuracy/AUC computed at runtime — see model card
                 on the Planner page)
   optimizer.ts → wave-packing (parallel multi-dept crews) + EXACT constraint
                 placement (exhaustive window search minimizing delay cost,
                 crew-capacity + single-occupancy constraints) + 500-run Monte
                 Carlo resilience simulation (histogram persisted per plan)
   simulate.ts  → cascade what-if engine (named-train arrivals + ambient flow,
                 ₹ cost model, red-zone LC logic), federated consensus votes,
                 GenAI-style safety work orders, Final-Boss multi-crisis resolver
   livetrains.ts→ real train roster kinematics on real track polylines
   jobs.ts      → 5-step workflow + GPS haversine fraud checks + escalation
                 levels (T+15/T+30/T+60) + DRM override
```

Real-world data: 19 real stations (true lat/lng), 23 real sections with waypoint alignments,
the real Yamuna course, and 24 real trains (12951/52 Mumbai Rajdhani, 12301/02 Howrah Rajdhani,
22439 Vande Bharat, Namo Bharat RRTS, DFC super-heavies…) running real schedules.

## What's real vs. simulated (read this before judging)

**Genuinely implemented**

- Trained statistical model for 72-h failure probability — not a hardcoded lookup; the
  logistic-regression weights are fitted at runtime with gradient descent and reported
  with computed holdout accuracy. **The model drives the plan**: every backlog item is scored with
  `predictRisk()` using its own overdue age and linked asset health (it previously drove only the
  what-if lab while a hand-written formula ranked the queue — see `FEATURE_ROADMAP.md` §0.1).
  It trains on synthetic-but-principled labeled data, since real IR failure logs aren't public —
  stated honestly on the model card.
- Every headline number is computed at run time. `↓34% block downtime`, `12.1 → 5.0 min/train`
  and `15 occupancy conflicts eliminated` come from `POST /api/optimize` on the seeded grid and are
  asserted by `verify.mjs`; the constants that used to stand in for them (`reductionPct: 38`,
  `baselineAvgDelay = 27 + rng()*9`, fabricated `state.ts` fallbacks) were removed.
- The manual process we compare against is a **modelled** sequential-silo baseline (each department
  books its own block, own setup time, conventional mid-window start, no bundling) — deterministic
  and documented, not a claim about real BDMS logs. Labelled that way in the UI.
- Exact constraint-based solver pass over the window-placement subproblem (exhaustive
  objective evaluation with hard constraints). We deliberately did **not** bind OR-Tools/
  CP-SAT: its native binaries are fragile on demo machines, and the exact search over
  this instance size (≤26 blocks × window grid) is provably optimal for the same
  objective — same guarantee, zero install risk at the booth.
- Monte Carlo stress distribution (500 samples, real histogram persisted & rendered).
- Cross-department consensus votes — computed live from real TMS/TDMS/SMMS section
  data (severity + health-drag, deterministic). We label it a heuristic vote, not
  "federated learning": there is no FedAvg and we no longer claim one.
- Haversine GPS fraud checks, escalation timers, exact train-kinematics positioning,
  exact delay-cost model shared by optimizer / resize API / what-if lab.
- The entire 5-step workflow with cross-dashboard state (start work → section red,
  sign-off → section green).

**Simulated by design (demo datasets, swappable transports)**

- Maintenance **ages/overdue days** are generated from each asset's inspection cycle in the seeded
  lake. The derivation is real (`age − cycle`), the dataset is synthetic.
- External feeds (TMS/TDMS/SMMS/COA/FOIS/IMD) are served from the seeded data lake via
  documented contracts (`src/lib/integrations/contracts.ts`) — `GET /api/ingest?system=TMS`
  executes a contract-shaped ingestion cycle. Point the adapters at real endpoints to go live.
- Train delays, federated consensus votes and Monte Carlo perturbations use seeded RNG
  (deterministic demos). The *models wrapped around them* are real code.
- LLM-style documents (work orders, job permits) are template-generated with rule citations,
  presented without claiming a hosted LLM dependency.
- Webhooks to NTES/SIMRAN shown in the UI are clearly labeled example payloads — no live
  government endpoints are contacted.
- Role sign-in is a **demo stub** (localStorage). Production design: SSO via CRIS/Parivartan
  with signed JWT + route-level RBAC middleware.

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection (Drizzle + drizzle-kit push) |

## API map (selected)

`GET /api/state` · `GET /api/defects` → `{defects, count}` · `GET /api/jobs` → `{jobs, count}` ·
`POST /api/seed {force:true}` (rebuild demo lake) ·
`POST /api/optimize {horizon: ROLLING|WEEKLY|MONTHLY}`
· `POST /api/whatif` · `POST /api/consensus` · `POST /api/safety-order` · `POST /api/crisis`
· `POST /api/jobs/{report,allot,start,complete,review,extend}` · `PATCH /api/blocks` (drag-resize)
· `POST /api/mode` (fog/VIP/DTP) · `POST /api/veto` (approve/veto; approval is policy-gated)
· `GET /api/ingest?system=…` · `GET /api/policy` (live rule-book verdict for the plan)
· `GET /api/explain?blockItemId=N` (why that block, that night, that length)
· `POST|GET /api/benchmark` (AI plan vs N simulated divisional allocation meetings)

## Front-end notes

- Fonts are **self-hosted** (`public/fonts`, `@font-face` in `globals.css`) rather than pulled via
  `next/font/google`, which downloads at build time and therefore fails outright on a machine with
  no internet — i.e. exactly what a conference laptop does to you. Devanagari is included so the
  Hindi mode renders in a real Devanagari face instead of whatever the OS supplies.

## Performance & reliability notes

- Dashboards poll with **change detection** (signature compare) — zero re-render when idle.
- The SVG rail grid is memoized; heavy fog blur reduced for GPU repaint cost.
- Every async action has busy/disabled guards; every field photo has an error fallback.
- Self-healing seed: wiping the DB re-seeds automatically on next request.

## Report structure

- `src/db/schema.ts` — stations, sections, assets (+maintenance cycle), defects (+overdue days,
  duration, inspection mode, block requirement, asset link), plans, block items, jobs, events, settings
- `src/lib/engine/severity.ts` — the single severity label↔number mapping (three private copies used
  to disagree, which is how one API returned 0–100 and a table cell multiplied it by 100 again)
- `src/lib/engine/` — ml, optimizer, simulate, livetrains, jobs, state, seed, network, types
- `src/components/` — map, feeds, boards, modals, role dashboards
- `scripts/verify.mjs` — executable invariant checks (run against any deployed URL)
