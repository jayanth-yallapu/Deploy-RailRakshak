# RAIL RAKSHAK — Feature Proposals for PS #26027 (jury-facing)

> **STATUS 2026-09-10 — TIER 0 IS DONE.** All four credibility holes below are fixed, on both the
> dev server and a production `next start` build:
>
> | gate | before | after |
> | --- | --- | --- |
> | `npx tsc --noEmit` | 14 errors | **0 errors** |
> | `npm run build` | failed (needs network for fonts) | **passes offline**, type-checks in-build |
> | `node scripts/verify.mjs` | 8 / 15 | **30 / 30** |
> | `node scripts/smoke.mjs` | (didn't exist) | **18 / 18** (8 pages · 5 endpoints · 5 lake checks) |
> | seeded lake | 10 stations · 7 sections · 0 defects · 0 assets · 0 jobs | **19 · 23 · 97 defects · 84 assets · 12 work orders · 1 opening plan** |
>
> Also fixed on the way: `/api/defects` + `/api/jobs` returned unusable payloads (snake_case
> re-mapping / raw rows) so the planner queue and job cards were empty; the fog/VIP/DTP toggles wrote
> settings keys the optimizer never read; `failureProb72h` was 0–100 in the API and multiplied by 100
> again in the table; the what-if lab summed failure probabilities (could exceed 100%); the rolling
> 4-hour plan could only ever fire at ~02:00 (dead at demo hours); planning consumed the backlog so a
> second click found nothing; seed rebuilds could race between processes; the landing page hardcoded
> "↓42%" and "~7.2 min" while the engine computed something else.
>
> Headline numbers are now measured, not asserted: **82.3 h → 54.5 h block downtime (↓34%)**,
> **12.1 → 5.0 min average train delay (↓79%)**, **9 super-blocks**, **15 occupancy conflicts
> eliminated**, all against a deterministic sequential-silo baseline, all asserted by `verify.mjs`.
>
> Tier 1–4 below are still open. **TIER 4 is the new material you asked for: loco pilot, passenger
> safety and work organisation.**

**Read this first.** You already have more than most teams: live grid, trained model, exact
window solver, Monte Carlo, 5-step field workflow, what-if lab, Hindi UI, verify.mjs. So don't
add "another dashboard". Add the three things a Railways jury actually scores and your app
currently can't show yet:

1. **Proof it beats the current manual process** (real numbers, not hardcoded `↓ 42%`).
2. **Domain legality** — a plan that violates Railway Board block policy is unusable, so a judge
   will ask "would DRM actually be allowed to approve this?" Right now nothing answers that.
3. **Trust/explainability** — for a government AI system, "why this block at 00:30?" must be
   answerable per decision, not per model card.

Every item below names the file to touch, the demo line to say, and an acceptance test — so
nothing here is aspirational hand-waving.

---

## TIER 0 — Fix these before you demo ✅ DONE (details kept so you can explain them to a judge)

These are not features. They are the four things a technical judge can find in 5 minutes and use
to discount everything else. All four are **measured**, not guessed — baseline captured 2026-09-10
against a live dev server with a fresh Postgres:

| check | baseline |
| --- | --- |
| `npx tsc --noEmit` | **14 errors** |
| `npm run build` | **fails** (next/font/google needs network at build time) |
| `node scripts/verify.mjs` | **8 passed, 7 failed** |
| `node scripts/smoke.mjs` | 14 passed, **4 failed** (all data-lake) |
| DB after auto-seed | stations 10/19 · segments 7/23 · **assets 0 · defects 0 · jobs 0 · events 0** |

### 0.1 The trained model does not drive the plan (highest priority)

Evidence in the current tree:

- `src/lib/engine/optimizer.ts:151` and `:374` call `scoreDefectSimple()` — a hand-written
  formula with its own made-up risk proxy:
  `prob = min(0.99, severity/10*0.6 + criticality/10*0.4)`.
- `predictRisk()` (the fitted logistic regression in `ml.ts`) is **only** reached via `riskFor()`
  from `src/lib/engine/simulate.ts:99`, i.e. from the what-if lab — not from prioritisation.
- Root cause: `src/db/schema.ts` `defects` table was "simplified" and lost `overdue_days`,
  `duration_min`, `inspection_mode`, `asset_id`, `failure_prob_72h`. So `state.ts:68-70` hardcodes
  `overdueDays: 0`, `durationMin: 60`, `inspectionMode: "physical"` and
  `state.ts:141` sets `virtualInspections = 0 // no inspectionMode column`.

So the README line "AI/ML prioritises tasks" is true of the *model*, false of the *plan*. A judge
reading the optimizer will catch it.

**Fix:** restore the data contract (schema columns + migration + seed values), then delete
`scoreDefectSimple` and route Phase 1 through `scoreDefect()`/`riskFor()`. ~1 h. Now every block
is genuinely produced by a trained classifier whose weights you can show.

### 0.2 `npm run build` fails on an offline machine (demo-day risk)

Two independent causes:

- **14 TypeScript errors** (`npx tsc --noEmit`): `src/app/api/defects/route.ts:12-23` maps
  `d.segment_id / d.photo_path / d.failure_prob_72h / d.overdue_days / d.created_at` — Drizzle
  returns camelCase keys, so those are `undefined` at runtime (your `/api/defects` is silently
  returning nulls) and a hard error at build. Also `simulate.ts:97,99,171,182` reads
  `d.assetId` / `d.failureProb72h` off a raw defect row.
- **`next/font/google`** in `src/app/layout.tsx:3` needs internet at *build* time. Conference wifi
  or a judge's laptop without connectivity ⇒ the app cannot be built, not merely "looks
  different". Self-host the two fonts with `next/font/local` (JetBrains Mono + Plus Jakarta Sans
  variable woff2 in `public/fonts/`) and the build becomes hermetic.

**Fix both.** Add them to `scripts/verify.mjs` as gate #16/#17 so it never regresses.

### 0.3 Headline KPIs are partly fabricated

- `optimizer.ts:456` → `reductionPct: 38` (constant) for the rolling plan.
- `optimizer.ts:250` → `baselineAvgDelay = 27 + rng()*9` — a random number dressed as a baseline.
- `optimizer.ts:245` → `baselineMin = scored.length * (60+40)` — a straw-man "one block per
  defect" baseline, not the actual manual process.

If the slide says "42% downtime reduction vs manual BDMS", the number must come from Tier 1.1
below. Until then, relabel it honestly in the UI as "vs single-defect sequential baseline" — one
honest label beats a defended lie, and "we measured it" is worth more marks than "we claimed it".

---

### 0.4 The seed script was replaced by a toy — this is why other pages broke

`src/lib/engine/seed.ts` no longer seeds the system; it inserts **10 hardcoded stations and 7
segments with `x: 0, y: 0`** and nothing else.

- **No defects, no assets, no jobs, no events** are ever inserted ⇒ `/planner` has nothing to
  optimise (`verify.mjs`: *"optimizer produces blocks — 0"*), `/jobs` and `/field` are empty,
  the Gantt is blank, and `RailMap` projects every station to the origin because x/y are 0.
- `ensureSeeded()` returns early if *any* station row exists
  (`if (existing.length > 0) return`) ⇒ once the toy seed ran, the real seed can **never** run.
  The README's "self-healing seed" promise is dead: wipe the DB and you re-seed the toy.
- The README/`verify.mjs` still claim 19 stations / 23 sections, so three of the 15 invariant
  checks fail purely because of this.
- Settings keys disagree: seed writes `fog_mode`, `vip_corridor`, `dtp_redzone`, but
  `optimizer.ts:124-126` and `state.ts` read `fogMode`, `vipAlert`, `dtpRedZone` ⇒ **the fog /
  VIP / DTP toggles in the UI silently do nothing** to the optimizer. That is a demo-visible bug:
  flip Fog Mode, nothing gets suspended.

The good news: this is a rewiring job, not an invention job. `src/lib/engine/network.ts` already
contains the real source of truth (verified: **19 `STATIONS`, 23 `SEGMENTS`, plus `YAMUNA_GEO`,
TRAINS, COST**) with true lat/lng and `project()`. So the fix is: seed **from** `network.ts`,
generate defects/assets/jobs against those 23 sections, use `project()` for x/y, align settings
keys, and make `ensureSeeded()` gate on defect count instead of station existence.

---

## THE CONTRACT — how I keep the site working while doing this

Rule: **a change is not "done" until the gate is green; if the gate is red, I fix it or revert
it in the same step.** Nothing half-broken gets handed over, and nothing gets handed over as
"should work, please check".

After every step, all five must pass:

1. `npx tsc --noEmit` → **0 errors** (this is the check whose absence caused the current 14
   errors — schema was "simplified" and no consumer was updated, and nobody noticed because dev
   server compiles per-route and never blocks on types).
2. `npm run build` **with the font CDN unreachable** → must succeed (proves offline-safe demo).
3. `node scripts/verify.mjs http://localhost:3000` → **15/15** business invariants.
4. `node scripts/smoke.mjs http://localhost:3000` → 8 pages render their *own* component tree,
   5 endpoints shaped, 5 data-lake checks seeded (script added today; it is what catches
   "fixed the planner, blanked the field page").
5. Row-count assertion for any table I touched (a schema/DTO change that leaves a table empty
   fails here, not in front of a judge).

Plus four habits that specifically prevent the vibe-coding failure mode:

- **No column is removed without grepping every consumer** —
  `grep -rn "overdue_days\|assetId\|failureProb72h" src` has to come back clean, because
  deleting a column while `simulate.ts:97` still reads it is exactly what broke this repo.
- **One commit per step**, message names the touched files ⇒ any regression is a single
  `git revert`, and you can see what changed without reading a diff novel.
- **Engine changes come with a `verify.mjs` assertion**, so a claim in the README that I make
  becomes an executable check; if I can't assert it, I don't claim it.
- **Honest relabel before a fix**: if a feature turns out too big for the remaining time, I
  downgrade the README/UI wording first (as already done for "federated learning") rather than
  leave an undefendable claim standing.

**What I cannot verify from this sandbox, stated up front:** there is no browser here (the
Playwright CDN is blocked), so client-side *hydration/runtime* errors and visual layout can't be
auto-checked. Everything above is server-side truth: types, build, HTML render, API contracts, DB
state. For the interaction pass I give you a 6-click checklist, and I write the code defensively
(busy guards, optional chaining on every DTO read) — that's also why the smoke test asserts
content markers rather than just HTTP 200.

---

## TIER 1 — Five features that win this problem statement

Ordered by (marks gained) ÷ (hours spent). Each one maps to a numbered requirement in the PS text.

### 1.1 Manual-vs-AI Benchmark Harness → *the* numbers slide

**What.** A deterministic simulation of how blocks are *actually* planned today, run through the
same objective as the optimizer, so "we improve availability" becomes a measured claim.

Implement `src/lib/engine/benchmark.ts`:

- Generate `N = 100` human-style plans from `PLANNER_BEHAVIOURS`: siloed departments each
  maximise their own backlog (ENG gets first pick of the golden window, then TRD, then SNT —
  exactly today's BDMS queueing), first-come-first-served, "my division first" bias, no bundling
  (so 3 separate blocks where you need 1 super-block), occasional stale copy-paste of last week's
  slot. All seeded RNG → same result on the judge's laptop.
- Score every plan (AI + each of the 100 manual ones) with the **same** functions the optimizer
  uses: `delayCostEstimate`, downtime minutes, super-block count, coverage.
- Report mean/median/p95, **win rate** ("AI beat 97/100 manual planners"), and a bootstrap 95%
  CI on the downtime delta (40 lines of JS, no stats library). Persist as a `benchmarks` table row
  so the figure in the UI *is* the measurement.

**Why it wins.** PS requirement 3 literally asks to "optimize … by minimizing downtime"; nothing
in the current repo measures it against the incumbent process. This is the single most
"engineering-college-final-year-flipping" artefact you can add, and it doubles as the content of
slide 2.

**Demo line:** *"We didn't guess the improvement. We re-ran the way 100 different divisional
planning committees would have done it, and our plan beat 97 of them. Here's the distribution."*

**Effort:** 4–6 h · **Accept:** `GET /api/benchmark` returns `{ aiDowntimeH, manualMedianH,
winRate, ciLow, ciHigh, n: 100 }`; `verify.mjs` asserts `winRate > 0.8` and `aiDowntimeH <
manualMedianH`; UI bar-chart on `/planner`; CSV export of all 100 plans.

---

### 1.2 Block-Policy Compliance Engine → *the* "they understand Railways" feature

**What.** `src/lib/engine/policy.ts` + `src/lib/engine/policyRules.ts`: every proposed block is
checked by rules-as-data before it can be approved. Each rule = `{ id, appliesTo, check(block,
ctx), severity, source }`. Enforce at plan time, show violations on the block row, and let DRM
approve only *with recorded override*.

Rules to encode (these are real planning constraints from Railway Board block-policy practice and
IRPM/maintenance manuals — **fill `source` from the documents you can obtain; keep text
paraphrased, not invented verbatim quotes**):

| rule | check | why a judge nods |
| --- | --- | --- |
| `WINDOW_NIGHT` | dense-corridor blocks only inside the notified night window | today's optimizer always emits `window: "GOLDEN"` — free to make it a *verified* claim |
| `MAX_HOURS` | block length ≤ department norm (ENG/TRD/SNT), else it must be declared a mega-block | |
| `COVERAGE_ROTATION` | every section receives its statutory cycle coverage within the horizon (currently impossible to assert) | directly answers "maximize asset availability" |
| `ROUTE_DIVERSITY` | never simultaneously block two sections of the same multi-route corridor when traffic has no alternate path | this is the "impact on train operations" the PS cares about |
| `EXCLUSION_CALENDAR` | no blocks in festival/peak rush blackout dates, VIP movement windows | shows calendar awareness |
| `JOINT_BLOCK` | multi-dept blocks require all departments' PTW + same sign-out time | the actual coordination failure the PS describes |
| `OHE_EARTHING` | TRD work at >25 kV requires isolation + earthing done before start | safety-critical, cheap to show |
| `MIN_RECOVERY` | gap between consecutive blocks on a section ≥ recovery buffer | |
| `CONFLICT` | same segment + overlapping minutes ⇒ hard reject (single occupancy) | |

Surface: `complianceScore` + `violations[]` on `PlanDTO.kpis`, a red/green chip per block in
`GanttChart.tsx`, a "Policy Ledger" panel in `PlannerClient.tsx` with rule id + source, and
`DrmRow.tsx` gating approval. Endpoint `GET /api/policy?planId=…`, and re-run on drag in
`PATCH /api/blocks` so dragging a block into 09:00 *instantly* turns the row red.

**Why it wins.** It converts your app from "a scheduler" to "a system that can sit next to BDMS".
It's also the cheapest place to demonstrate domain depth, and the drag-to-violate interaction
makes it visible in 10 seconds of demo.

**Demo line:** *"Before a plan can be sanctioned, every block is validated against the block
policy — the control office can't push a 6-hour OHE block into peak hours because the gate
refuses it, and if the DRM overrides, that override is recorded against a rule id."*

**Effort:** 5–7 h for 6 rules (add more later) · **Accept:** dragging a block to 09:00 yields
`complianceScore` drop + visible violation with rule id; `verify.mjs` asserts a plan with a hard
`CONFLICT` cannot reach `APPROVED` unless `override.reason` is non-empty.

---

### 1.3 Per-decision Explainability + Counterfactuals

**What.** `explainRisk()` in `ml.ts`: a logit model is exactly additive, so `contrib_j =
w_j · x_j` gives a real SHAP-equivalent (no library). Plus **policy/optimizer-level** "why":

- why now / why not deferred: cost delta from the *already computed* window search
  (`optimizer.ts` Phase 2b evaluates every 15-min slot — keep the second-best slot and its cost,
  and show "moving to 02:15 costs +340 train-min").
- counterfactual slider: "if overdue were 0 days, 72-h risk 0.71 → 0.33 ⇒ block deferred"
  (one `predictRisk()` call — genuine, cheap, and the most convincing thing you can show a
  non-CS judge).
- "what made the AI reject me": for defects that were suspended by fog/VIP, show the actual
  reason + score vs cutoff, so the queue is auditable.

UI: expandable "Why" drawer on each block row in `PlannerClient.tsx`, contribution bar chart,
one-line verdict in plain English + Hindi (reuse `translations.ts`).

**Why it wins.** "AI must be explainable" is a standing expectation for govt deployments, and PS
requirement 2 says "prioritize … based on criticality, urgency, impact". You now show the
arithmetic for exactly that. Zero risk of overclaiming: it's algebra.

**Effort:** 3 h · **Accept:** every `BlockItemDTO` can be expanded to show per-feature
contributions summing to the displayed score (assert in `verify.mjs`: `|Σcontrib − logit| < 1e-6`).

---

### 1.4 Shared Machine & Gang Capacity as a First-Class Resource

**What.** The genuinely hard part of Indian Railways block planning is not the window — it's that
**MTT / tamping machines, POLE car, SDC/USFD cars, PCC and the limited skilled gangs are shared
across divisions and must physically travel between sections.** Today `packWaves()`
(`optimizer.ts:73`) is *dead code* — never called — so nothing models it.

Add `resources` table (`type: MTT|TAMPER|POLE_CAR|USFD|GANG`, `dept`, `division`, `count`,
`speedKmph`, `depotStationId`), attach each block a required machine + gang size, and extend the
solver:

- hard constraint: one machine ⇒ one active block at a time, globally (not per-department);
- travel time between consecutive jobs = `sectionKm / maxSpeed` using `segmentPathD()` from
  `network.ts` (you already have real geometry — reuse it, that's a nice touch);
- objective now = delay cost + **machine idle cost (₹/hr of a parked MTT)** + travel cost;
- new KPI: `machineUtilisationPct` + "idle minutes eliminated".

Show it as a "Machine allocation" swimlane in `GanttChart.tsx`: one row per machine, blocks
colour-coded, grey travel bars between them. If a machine would have to teleport, refuse and
explain.

**Why it wins.** It's the strongest possible answer to "poor coordination … inefficient block
utilisation" in the PS, it's real OR (single-machine scheduling with sequence-dependent travel and
time windows), and the swimlane is instantly readable by a non-technical judge.

**Effort:** 6–9 h (cut scope to 2 machine types if short on time) · **Accept:** plan containing
two blocks needing the same MTT at overlapping minutes is rejected by `verify.mjs`; utilisation KPI
changes when bundling is enabled vs disabled.

---

### 1.5 Incremental Re-plan with Plan Diff (stability) → requirement 4

**What.** Ops reality: at 02:10 a patroller reports a rail crack; you cannot re-issue tomorrow's
whole plan. Implement `replanIncremental(planId, event)`:

- freeze blocks already signed in or started;
- re-optimise only the affected day(s) + sections;
- compute **diff** against the previous plan: `added / moved / dropped / unchanged`;
- KPI `stabilityPct = unchanged / total`, with a weighted term penalising churn (so the optimizer
  prefers plans it won't have to rewrite at 2 a.m.).
- UI: side-by-side "Plan v3 → v4" with animated deltas in `PlannerClient.tsx` + a "Notify affected
  departments" action (only for changed blocks).

**Why it wins.** Nobody else at a hackathon will have this, and every reviewer who has ever run an
operations system recognises it immediately. It also justifies your WEEKLY/MONTHLY horizons: show
monthly plan *drifting* into weekly as dates approach (rolling-horizon refinement = textbook
planning, easy to name-drop accurately).

**Effort:** 4 h · **Accept:** insert one critical defect → `stabilityPct > 70%` and only the
affected day's blocks change (assert in `verify.mjs`).

---

## TIER 2 — Adoption features (cheap, look expensive)

| # | Feature | Why the jury cares | Effort | Where |
| --- | --- | --- | --- | --- |
| 2.1 | **Export pack**: printable Block Sanction Order (HTML→print-to-PDF), weekly plan CSV/XLSX, `.ics` for gang diaries, auto-filled BDMS request payload | Judges literally hand things to each other; "deployable into existing workflow, not rip-and-replace" | 3 h | new `/api/export/*` |
| 2.2 | **Command bar** (EN + HI): "dikhao NDLS ke critical defects is week" → filter/nav/action via a small intent grammar over existing state | Instant demo wow; no LLM dependency ⇒ works offline; keep it honest as "deterministic NL router" | 4 h | new `src/lib/nl.ts` + `TopBar.tsx` |
| 2.3 | **Voice-first defect reporting** for patrollers (Web Speech API + your `translations.ts`, offline-fallback to typed) | Field staff literacy/typing is a genuine adoption barrier; social-impact judges love it, and it is the PS's "uninterrupted operations" at the input end | 3 h | `src/app/patrol/page.tsx` |
| 2.4 | **Tamper-evident audit chain**: SHA-256 hash-chained `decisionLog` (each AI action + human override links to previous), `GET /api/audit/verify` | Government AI = accountability; costs 60 lines; pairs beautifully with veto | 2 h | `state.ts`, new route |
| 2.5 | **Real RBAC**: signed JWT cookie + route middleware + per-role field redaction (replace the localStorage stub, keep demo mode) | Your README flags it as a stub; a security-minded judge will too | 4 h | new `src/lib/auth.ts`, `middleware.ts` |
| 2.6 | **Coverage/fairness ledger** per department & division: who got blocked how often, per-cycle, with Gini index | Prevents the degenerate "block the same easy section" optimum; shows equity between ENG/TRD/SNT — the exact conflict in the PS | 2 h | `policy.ts` + `KpiStrip.tsx` |

## TIER 3 — Wow factor (only if Tier 1 is done)

| # | Feature | Note |
| --- | --- | --- |
| 3.1 | **Live diversion solver**: when a section is blocked, run Dijkstra on your real station graph and report "N trains diverted via Y, +Z min each"; also compute *connectivity loss* (sections left unreachable) | You already have named trains + `segmentPathD`; this upgrades the cascade from "ambient flow" to actual routing. Strong, defensible |
| 3.2 | **National scale benchmark**: synthetic 500 sections × 4,000 defects — ms-to-solve, memory, per-division sharding story + IRICON rollup view | Scalability is a scoring criterion; show a curve, not a claim |
| 3.3 | **Photo triage (CV)**: lightweight colour/texture feature extractor + small trained head on your existing before/after photos, bbox overlay, `needsHumanConfirmation: true` | Only if you label it "prototype, 12 images, not a deployed detector". A fake "98% accurate CNN" will be destroyed in Q&A |
| 3.4 | **IMD forecast-driven pre-emption**: 72-h forecast pulls physical jobs *forward* before a fog spell and pushes virtual inspections after | Turns your fog toggle from a switch into a predictive capability |

---

## Do NOT add (attractive but net-negative under questioning)

- Claims of "federated learning" / "blockchain" / "digital twin" without the mechanism. Your
  README already corrected one of these — keep that discipline, it reads as engineering maturity.
- A hard dependency on a hosted LLM for work orders/permits (offline demo ⇒ dead app; also
  unverifiable output). Keep template+rules; optionally add "paste an API key to enable LLM polish".
- Real-time Google tiles / OSM tiles / YouTube embeds for the "look" — same offline trap as 0.2.
- More dashboards or dark-mode polish. Nothing about your UI is the weak point.
- Inventing IRPM para numbers as verbatim quotes. Keep rule text paraphrased with `source:
  "Railway Board block policy (2022) — to be verified"`. A Railways judge *will* know the real para.

---

## Suggested order if you have one week

| Day | Deliver |
| --- | --- |
| 1 | Tier 0 (all three) — app builds offline, model actually in the loop, KPIs computed |
| 2 | 1.1 benchmark harness + numbers slide |
| 3 | 1.2 policy engine (6 rules) + Gantt chips |
| 4 | 1.3 explainability drawer + counterfactual slider |
| 5 | 1.4 machine capacity swimlane (2 machine types) |
| 6 | 1.5 incremental re-plan diff + 2.4 audit chain |
| 7 | 2.1 exports, 2.2 command bar, rehearsal + `verify.mjs` all-green |

---

## TIER 4 — Loco pilot · passenger safety · work organisation (the "extend the blast radius" tier)

Your current system plans blocks for *fixed assets*. The three domains below are what makes a
Railways jury say "this team understands the whole system, not just the software". Each item lists
what it needs from your existing code — most of them reuse data you already have, which is why they
are cheap.

### 4A. RAKSHAK CAB — the loco pilot's side of a block (highest drama per hour spent)

The block only exists because a *train* must be kept out of it. Nobody in your stack currently
represents the person on the front of that train.

| # | Feature | Uses | Why it lands |
| --- | --- | --- | --- |
| 4A.1 | **Block Entry Authority (BEA) handshake** — pilot's cab app shows the sanctioned block no., sections red, protection state, and requires scanning the Site Controller's QR/PIN before entering; a missing handshake is an automatic `critical` event to COA + DRM | `jobs.ts` status machine, `block_items`, `RailMap` red sections | Turns "protection" from a UI badge into an enforced interlock. This is the single strongest safety story you can add |
| 4A.2 | **Digital Train Order / caution slip** — auto-generated TSR text, gradient, curve and posting km per affected train, from `sectionMeta().tsr` and the plan's windows | `sectionMeta()`, `COST`, plan blocks | Judges can read the artefact; it is what a TO actually looks like |
| 4A.3 | **Mis-entry projection** — using your existing train kinematics, predict the next 45 min of each train's position and alarm if a train is heading into a section that is (or is about to become) red | `livetrains.ts` `getLiveTrains()`, `trainDelayMin()` | You already compute exact positions. ~120 lines and it is a genuine collision-avoidance-adjacent feature |
| 4A.4 | **Crew-clear / line-clear declaration** closing loop: crew marks "tools clear, men clear" with photo+GPS → block released in COA automatically; overrun if not received by `windowEnd` | `jobs.ts` complete/extend, `overrun` | Completes report→release; "no line release without evidence" is a real pain point |
| 4A.5 | **Pilot duty-time & rest guard** — refuse to allocate a super-block that requires a gang/pilot who would exceed continuous-duty limits | new `crew` table | Bridges planning and labour law; pairs with 4C.1 |
| 4A.6 | **Cab offline mode** — signed queue of BEA/line-clear events when connectivity drops (tunnels, RRTS stretches), replayed on reconnect | existing offline queue in `/jobs` | Every field system in India must survive no-signal; showing it earns trust |

Honesty guardrail: describe 4A.1/4A.3 as a **management advisory layer**, *not* as a replacement for
Kavach or interlocking. Claiming safety-critical authority you don't have is the fastest way to lose
a technical judge; the correct framing is "advisory + audit trail, and it is designed so a Kavach
failure mode is never introduced".

### 4B. PASSENGER SAFETY & PASSENGER IMPACT (the "public value" tier)

| # | Feature | How | Marks it earns |
| --- | --- | --- | --- |
| 4B.1 | **Passenger-delay budget as a hard constraint** — optimizer must keep max aggregate passenger delay per train per day under a limit, and diverts low-priority work instead of violating it | add a term to the objective + a rejection reason; `delayCostEstimate` already gives affected trains | Turns "minimise disruption" from a slogan into an enforceable rule |
| 4B.2 | **Station crowd-overflow risk on diversion** — when N trains are diverted onto an alternate route/halt, flag platform & FOB overload (trains/hour vs capacity proxy) | `trafficFactor()`, station `dailyTrains` | Passenger-safety judges ask "what about the crowd?"; you answer with a number |
| 4B.3 | **Bus-substitution proposal** for mega-blocks — affected trains, passengers stranded, bus rakes needed, ₹ estimate | `WhatIfResult` cascade + `COST` | Real IR practice during disruptions; instantly understood |
| 4B.4 | **Auto-drafted passenger notice** (EN + HI) for NTES/social, derived from the approved plan, held for human release | `translations.ts`, plan blocks | "Communicates to passengers" is a soft criterion most teams ignore |
| 4B.5 | **Night-stranding rule** — no block that can leave a train waiting >30 min at an unlit halt after 22:00 without platform staffing notification; women's-safety lens | `DTP_RED_ZONES`, `sectionMeta()` | Social impact + genuinely IR-specific |
| 4B.6 | **Level-crossing conflict rule** — never close an LC gate that the diverted road traffic is being pushed onto | `isLevelCrossing`, `inRedZone()` | You already model red zones; this closes the loop with road safety |
| 4B.7 | **Emergency-revocation drill-down** — one click to revoke a block for a medical/security situation, with the cost of doing so shown in train-minutes | `crisis` console | Shows the AI obeys humans in an emergency — a design principle, demonstrated |

### 4C. WORK ORGANISATION (the departmental-reality tier)

| # | Feature | How | Why it's believable |
| --- | --- | --- | --- |
| 4C.1 | **Gang & supervisor rostering** — a block is only schedulable if the required crew exists that night; show labour utilisation and statutory rest | `packWaves()` already models one crew per dept; add availability windows | "We optimise resources, not just windows" |
| 4C.2 | **Machine fleet with travel + depot return** (= Tier 1.4) — MTT/trolley/USFD as scarce global resources | `network.ts` geometry for travel time | The strongest OR story in the whole project |
| 4C.3 | **Materials & departmental wagons** — a ballast/Pway block needs wagons at the site; if the yard can't hold them, defer | new `materials` ledger + station occupancy | Deeply real; almost nobody models it |
| 4C.4 | **Contractor + supervision register** — outsourced SNT/TRD work cannot get a block without a departmental supervisor free in that slot | crew availability (4C.1) | Answers "who signs the PTW?" |
| 4C.5 | **Tool Box Talk + PPE evidence gate** — job cannot start without a recorded safety brief; missing evidence escalates like an overrun | `jobs.ts` escalation ladder | Safety culture as a hard gate, not a poster |
| 4C.6 | **Rotation equity across sections, gangs and shifts** — Gini index / fairness KPI so no section or gang is permanently on night duty | plan-level metric | "AI is equitable" is an adoption argument, and it prevents degenerate optima |
| 4C.7 | **Weekly Block Review pack** (auto PDF: planned vs executed, overrun causes, deferred items with owners) | `generateSafetyOrder()` template machinery | The artefact a DRM actually takes to a meeting — deployment realism |

### 4D. How to *advance* it (depth that separates you from the field)

1. **Optimality, stated properly.** Keep the in-house exact search (it is genuinely optimal for the
   placement subproblem and never fails to install) and add an optional CP-SAT/MIP mode: report
   `gap to bound` when a solver is available, and *say so in the UI* when it isn't. "Exact when
   feasible, heuristic under scale, always measurable" is a mature answer to the "why not OR-Tools?"
   question.
2. **Learn from the humans.** Every veto/override in `veto`/`review` is a labelled preference. Re-fit
   the logistic weights on `(model score, human decision)` and show *"after 40 reviewer decisions,
   agreement with DRM rose from 71% to 88%"* — a real, defensible learning loop, ~1 day, and the only
   "AI that gets better" claim in the hall that you can actually prove.
3. **Say what you don't know.** Split-conformal prediction intervals on the 72-h risk from your
   holdout set (≈40 lines, no library): show "risk 0.68 (0.52–0.83, 90%)" and let a
   `p95 > threshold` rule force human review. Uncertainty quantification in a hackathon rail project
   is extremely rare and extremely persuasive.
4. **Value of waiting.** Deferral currently costs nothing in the objective. Add option value: Monte
   Carlo the risk growth if an item slips k days vs the delay saved by slipping it — that turns
   "prioritise" into a real decision rule and justifies the deferral reasons you already log.
5. **A safety case, not a feature list.** One page: fail-safe defaults (if the engine errors, the
   last approved plan stands), degraded mode (manual BDMS still works), human-authority matrix, audit
   chain, and "what happens when the model is wrong". PSU-style judges score this higher than
   any UI.
6. **Deployment ladder.** 1 division × 1 quarter pilot → metrics (block utilisation, overrun %,
   conflicts, coverage) → then a 3-tier rollout (division → zone → IRICON rollup). Say what you'd
   need: BDMS block history, TMS USFD/TRC exports, COA availability log, PTW register, machine
   availability, crew rosters. Being able to name the data ask accurately signals you understand
   the department.
7. **Money, with assumptions.** Extend `COST` into a benefit model: train-minutes × ₹/min,
   emergency work avoided × risk reduction, machine idle hours, and a ±50% sensitivity table on
   ₹/train-min. A judge who distrusts the number can at least see the lever.
8. **Reproducibility as a feature.** Ship the harness in the repo (done: `verify.mjs` 30 checks,
   `smoke.mjs` 18), plus the benchmark when you build 1.1. "Run one command, see it pass" is worth
   more than ten slides.

### 4E. Suggested cut for the final pitch (if you can only add two)

* **4A.1 + 4A.3 (Block Entry Authority + mis-entry projection)** — a safety story with the trains you
  already simulate, demonstrable in 40 seconds.
* **4B.1 (passenger-delay budget as a hard constraint)** — one constraint, and it reframes your
  optimizer as *safety- and passenger-aware*, which is exactly this problem statement's language.

Everything in 4C is the "credible in a department" tier — do 4C.2 (machines) if a judge is technical,
4C.7 (review pack) if a judge is managerial.

---
## 60-second demo that ties it together

1. Patroller photo (Hindi) → defect admitted, GPS + fraud check ✔
2. Risk model card: 2,400 samples, holdout acc/AUC, weights visible
3. Weekly optimize → 12 blocks, 7 super-blocks, machine swimlane, **policy: 12/12 compliant**
4. Drag a block to 09:00 → row turns red, `WINDOW_NIGHT` violation, approve blocked without reason
5. "Why 00:30?" → contribution bars + "moving to 02:15 costs +340 train-min"
6. New critical defect at 02:10 → incremental re-plan: 2 blocks moved, 88% stable, diffs notified
7. Benchmark slide: AI beat 97/100 simulated manual committees, downtime −X% (95% CI)
8. Export sanction order + `node scripts/verify.mjs` → all green
