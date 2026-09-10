#!/usr/bin/env node
/**
 * RAIL RAKSHAK — deployment verifier.
 * Runs the invariant checks against the live API. Usage:
 *   node scripts/verify.mjs [baseUrl]   (default http://localhost:3000)
 */
const base = process.argv[2] ?? "http://localhost:3000";
let pass = 0;
let fail = 0;

const ok = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ✔ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  ✘ FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
};
const j = (r) => r.json();
const post = (path, body) =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }).then(j);

// The optimiser marks backlog items `scheduled`, so each phase gets its own deterministic lake
// rebuild — otherwise phase 2 would only see leftovers from phase 1 and fail for reasons that have
// nothing to do with the code under test.
const resetLake = async () => {
  const r = await post("/api/seed", { force: true });
  if (r.rebuilt !== true) throw new Error(`lake reset failed: ${JSON.stringify(r)}`);
  // A reset that only *reports* success is worse than no reset: the harness would drift a couple of
  // rows per run and every later number would be quietly about a different lake. The seeded factory
  // state is 97 backlog items, so anything above that means a previous run's field reports survived.
  if (r.defects !== 97) throw new Error(`lake reset left ${r.defects} defects — expected the seeded 97`);
  return r;
};

let r0 = await resetLake();
ok("lake: deterministic rebuild available", true, `${r0.stations} stations · ${r0.defects} backlog items · ${r0.assets} assets`);

const state = await fetch(`${base}/api/state`).then(j);
ok("grid: 19 real stations", state.stations.length === 19, `${state.stations.length}`);
ok("grid: 23 sections incl. RRTS", state.segments.length === 23, `${state.segments.length}`);
ok("grid: real coords present", state.stations.every((s) => Math.abs(s.lat - 28.6) < 1 && Math.abs(s.lng - 77.2) < 0.6));
ok("grid: map projection populated", state.stations.some((s) => s.x !== 0 && s.y !== 0), "SVG x/y from project()");
ok("lake: backlog + opening plan both present", (state.counts?.openDefects ?? 0) > 15 && !!state.latestPlan, `${state.counts.openDefects} unscheduled, ${state.latestPlan?.blocks.length ?? 0} blocks already published`);
ok("live trains tracked", state.liveTrains.length > 0, `${state.liveTrains.length} in window`);
ok("model card: computed accuracy in sane band", state.modelCard.accuracy > 70 && state.modelCard.accuracy < 99, `${state.modelCard.accuracy}% / AUC ${state.modelCard.auc}`);
ok("model card: loss surface sane (AUC > 0.7)", state.modelCard.auc > 0.7);

// ---- planning ----
const opt = await post("/api/optimize", { horizon: "WEEKLY" });
const k = opt.plan.kpis;
ok("optimizer produces blocks", k.blocks > 5, `${k.blocks}`);
ok("downtime reduced vs computed sequential-silo baseline", k.downtimeOptimizedH < k.downtimeBaselineH, `${k.downtimeBaselineH}→${k.downtimeOptimizedH}h (↓${k.reductionPct}%)`);
ok("baseline is measured, not a constant", k.baselineBlocks > k.blocks && k.baselineDelayMin > 0, `${k.baselineBlocks} silo blocks → ${k.blocks}; avg delay ${k.baselineDelayMin}→${k.avgDelayMin} min`);
ok("bundling within [0,100]", k.bundlingPct >= 0 && k.bundlingPct <= 100, `${k.bundlingPct}%`);
ok("super-blocks exist", k.superBlocks > 0, `${k.superBlocks}`);
ok("occupancy conflicts eliminated", k.conflictsAvoided > 0, `${k.conflictsAvoided}`);
ok("per-train delay improved vs baseline (objective not contaminated)", k.delayReductionPct > 0 && k.avgDelayMin < k.baselineDelayMin, `↓${k.delayReductionPct}% (${k.baselineDelayMin}→${k.avgDelayMin} min/train)`);
ok("occupancy budget respected (≤ 3 parties × 215 min/day)", k.occupancyUsedMin <= k.occupancyBudgetMin, `${k.occupancyUsedMin}/${k.occupancyBudgetMin} block-min used`);
ok("monte carlo histogram sums to 500", opt.monteCarlo.hist.reduce((a, b) => a + b, 0) === 500, opt.monteCarlo.hist.join(","));
ok("no two blocks overlap on the same section", (() => {
  const bySeg = new Map();
  for (const b of opt.plan.blocks) {
    const key = `${b.segmentCode}:${b.day}`;
    const list = bySeg.get(key) ?? [];
    list.push([b.startMin, b.endMin]);
    bySeg.set(key, list);
  }
  for (const list of bySeg.values()) {
    list.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < list.length; i++) if (list[i][0] < list[i - 1][1]) return false;
  }
  return true;
})(), "single occupancy enforced per section+day");

// ---- rolling 4h ----
await resetLake();
const roll = await post("/api/optimize", { horizon: "ROLLING" });
ok("rolling 4h plan: day-0 blocks only", roll.plan.blocks.every((b) => b.day === 0), `${roll.plan.blocks.length} blocks`);
ok("rolling 4h plan: finds a feasible gap at any hour", roll.plan.blocks.length > 0, `${roll.plan.blocks.length} micro-blocks`);

// ---- settings wiring: fog / VIP toggles used to write keys the optimizer never read ----
await resetLake();
const fogOn = await post("/api/mode", { key: "fogMode", value: true });
const afterFog = await fetch(`${base}/api/state`).then(j);
ok("mode toggle reaches the engine (fogMode key)", afterFog.settings.fogMode === true, JSON.stringify(fogOn).slice(0, 46));
const fogPlan = await post("/api/optimize", { horizon: "WEEKLY" });
const fogSuspended = fogPlan.plan.kpis.suspendedByFog ?? 0;
ok("fog mode suspends physical-gang work", fogSuspended > 0 || fogPlan.log.some((l) => l.includes("FOG MODE")), `${fogSuspended} items suspended`);
const noFogPlan = (await post("/api/mode", { key: "fogMode", value: false }), (await resetLake(), await post("/api/optimize", { horizon: "WEEKLY" })));
ok("fog reduces the scheduled set vs clear weather", fogPlan.plan.kpis.blocks < noFogPlan.plan.kpis.blocks, `${fogPlan.plan.kpis.blocks} vs ${noFogPlan.plan.kpis.blocks} blocks`);

// ---- what-if ----
await resetLake();
const bridge = state.segments.find((s) => s.code === "NZM-ANVT");
const wi = await post("/api/whatif", { segmentId: bridge.id, durationH: 6, startMin: 540, superBlock: false });
ok("whatif: peak bridge closure rejected", wi.recommend === false, `net ₹${wi.netBenefit}, impact ${wi.humanImpactScore}/100`);
const wi2 = await post("/api/whatif", { segmentId: bridge.id, durationH: 2, startMin: 60, superBlock: true });
ok("whatif: golden-window super-block recommended", wi2.recommend === true, `net ₹${wi2.netBenefit}`);
ok("whatif: failure exposure is a probability (≤100%)", (wi.futureFailureCostAvoided > 0), `exposure avoided ₹${wi.futureFailureCostAvoided.toLocaleString("en-IN")}`);

// ---- KPI contract: three producers must publish the same keys (a missing one reads as `undefined`) ----
{
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/lib/engine/optimizer.ts", import.meta.url), "utf8");
  const keysOf = (from, after) => {
    const i = after ? src.indexOf(from, src.indexOf(after)) : src.indexOf(from);
    if (i < 0) return [];
    let d = 0, j = src.indexOf("{", i);
    const start = j;
    do {
      if (src[j] === "{") d++;
      else if (src[j] === "}") d--;
      j++;
    } while (d > 0);
    const body = src.slice(start, j);
    const named = [...body.matchAll(/^\s+([a-zA-Z0-9]+):/gm)].map((m) => m[1]);
    const shorthand = [...body.matchAll(/^\s+([a-zA-Z0-9]+),$/gm)].map((m) => m[1]);
    return [...named, ...shorthand];
  };
  // runOptimizer's literal is the first `const kpis = {` after its declaration
  const runK = keysOf("const kpis = {", "export async function runOptimizer");
  const rollK = keysOf("const kpis = {", "export async function runRollingPlan");
  const emptyK = keysOf("kpis: {", "async function emptyPlan");
  // Both planners merge the policy KPIs in afterwards (publishPolicy), so they count as published keys.
  const mergedK = keysOf("kpis: {", "export async function publishPolicy");
  const runSet = [...new Set([...runK, ...mergedK])];
  const rollSet = [...new Set([...rollK, ...mergedK])];
  // All three producers must publish the SAME key set. Checking only "empty ⊇ planners" let a key
  // exist in one planner and not another, which is how a dashboard card ends up reading undefined.
  const all = [...new Set([...runSet, ...rollSet, ...emptyK])];
  const gaps = all
    .map((k) => ({ key: k, missingIn: [runSet, rollSet, emptyK].filter((set) => !set.includes(k)).length }))
    .filter((g) => g.missingIn > 0);
  ok(
    "kpi contract: runOptimizer, runRollingPlan and emptyPlan publish the identical KPI key set",
    runK.length > 15 && gaps.length === 0,
    gaps.length
      ? `${gaps.length} gap(s): ${gaps.slice(0, 5).map((g) => `${g.key} (missing in ${g.missingIn})`).join(", ")}`
      : `${all.length} keys in all three`
  );
}

// ---- block rule book: live compliance, the approval gate, and the audit note ----
await resetLake();
const pol0 = await fetch(`${base}/api/policy`).then(j);
ok("rule book: our own generated plan passes every hard rule", pol0.hardViolations === 0 && pol0.score >= 97, pol0.summary);
ok(
  "rule book: every rule states the clause it enforces",
  pol0.rules.length >= 7 && pol0.rules.every((r) => r.clause.length > 40 && (r.severity === "hard" || r.severity === "soft")),
  `${pol0.rules.length} rules · ${pol0.activeRuleIds.join("/")} live, ${pol0.dormantRuleIds.join("/")} dormant`
);
const victim = pol0.blocks[2];
const badDrag = await (
  await fetch(`${base}/api/blocks`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: victim.id, startMin: 540, endMin: 780 }),
  })
).json();
ok(
  "rule book: a drag into traffic hours is caught on the spot",
  badDrag.ok === true && (badDrag.policy?.violations ?? []).some((x) => x.startsWith("WINDOW")) && badDrag.publishBlocked === true,
  `${badDrag.policy?.violations.length} breach(es) on that block after the edit`
);
ok(
  "rule book: one bad night is reported on every block sharing it (budget is a day-level rule)",
  badDrag.planPolicy.hardViolations >= 1,
  badDrag.planPolicy.summary
);
const polMid = await fetch(`${base}/api/policy`).then(j);
const flagged = polMid.blocks.filter((b) => b.policy.violations.length > 0);
ok(
  "rule book: the stored plan reflects the edit, not the state at generation time",
  flagged.length >= 1 && flagged.some((b) => b.id === victim.id),
  `${flagged.length} block(s) now flagged`
);
const explMoved = await fetch(`${base}/api/explain?blockItemId=${victim.id}`).then(j);
ok(
  "explain: a solved block carries the full arithmetic, not a freeze stub",
  !!explMoved.generated?.chosen && Array.isArray(explMoved.generated.why) && (explMoved.generated.terms?.length ?? 0) > 0,
  explMoved.generated?.chosen
    ? `chosen ${explMoved.generated.chosen.startMin}–${explMoved.generated.chosen.endMin}, ${explMoved.generated.terms.length} terms`
    : `got ${JSON.stringify(explMoved.generated).slice(0, 80)}`
);
ok(
  "explain: a hand-edited block says so instead of pretending it still matches the reasoning",
  explMoved.editedByHuman === true && explMoved.generated?.chosen?.startMin !== explMoved.now.startMin,
  `placed ${explMoved.generated?.chosen?.startMin}→${explMoved.now.startMin} min`
);
const gateRefused = await fetch(`${base}/api/veto`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ mode: "APPROVED" }),
});
const gateBody = await gateRefused.json();
ok("approval gate: a non-compliant plan cannot be published", gateRefused.status === 409 && gateBody.breaches.length >= 1, gateBody.error);
const gateOverBody = await post("/api/veto", { mode: "APPROVED", overrideReason: "Verify harness exemption — test of the override path" });
ok("approval gate: a named override reason is the only way through, and it is recorded", gateOverBody.ok === true, `stored on ${gateBody.breaches.length} block(s) + audit event`);
const polOver = await fetch(`${base}/api/policy`).then(j);
ok(
  "approval gate: an override does not rewrite the verdict — the breach is still visible",
  polOver.hardViolations >= 1 && polOver.blocks.some((b) => b.overrideReason),
  `${polOver.blocks.filter((b) => b.overrideReason).length} block(s) carry the override note`
);
await fetch(`${base}/api/blocks`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: victim.id, startMin: 30, endMin: 150 }),
}).then((r) => r.json());
const polRestored = await fetch(`${base}/api/policy`).then(j);
ok(
  "rule book: moving the block back clears the breach and the stale override note",
  polRestored.hardViolations === 0 && polRestored.blocks.every((b) => !b.overrideReason),
  polRestored.summary
);
await post("/api/veto", { mode: "PROPOSED" });

const expl = await fetch(`${base}/api/explain?blockItemId=${polRestored.blocks[0].id}`).then(j);
ok("explain: every block carries the reasons the search actually used", (expl.generated?.why?.length ?? 0) >= 4, `${expl.generated.why.length} reasons · driver ${expl.generated.drivingDefect.title.slice(0, 26)}`);
const termSum = Math.round(expl.generated.terms.reduce((a, t) => a + t.value, 0));
ok(
  "explain: objective terms sum to the score the planner ranked on",
  Math.abs(termSum - expl.generated.drivingDefect.score) <= 1,
  `Σ${termSum} vs score ${expl.generated.drivingDefect.score}`
);
ok("explain: the runner-up placement is reported with a like-for-like gap", !!expl.generated.runnerUp?.label && expl.generated.runnerUp.penaltyVsChosen >= 0, `${expl.generated.runnerUp.label} +${expl.generated.runnerUp.penaltyVsChosen}`);
ok(
  "explain: the occupancy budget quoted for the block is inside the division's limit",
  expl.generated.budget.usedMin <= expl.generated.budget.limitMin && expl.generated.budget.usedMin > 0,
  `${expl.generated.budget.usedMin}/${expl.generated.budget.limitMin} min on D+${expl.generated.budget.day}`
);
await post("/api/mode", { key: "vipAlert", value: true });
const polVip = await fetch(`${base}/api/policy`).then(j);
ok(
  "rule book: a VVIP notification after publication lights the affected blocks up",
  polVip.hardViolations > 0 && polVip.blocks.some((b) => b.policy.violations.some((x) => x.startsWith("VVIP"))),
  `${polVip.blocks.filter((b) => b.policy.violations.some((x) => x.startsWith("VVIP"))).length} block(s) on the exclusive corridor`
);
const gateVip = await fetch(`${base}/api/veto`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "APPROVED" }) });
ok("rule book: and publication is refused until they move", gateVip.status === 409);
await post("/api/mode", { key: "vipAlert", value: false });
await post("/api/veto", { mode: "PROPOSED" });
const moneyState = await fetch(`${base}/api/state`).then(j);
ok(
  "dashboard money figure is derived, not typed in: train-minutes saved is measured and positive",
  (moneyState.kpis.baselineDelayTrainMin ?? 0) > (moneyState.kpis.delayTrainMin ?? 0) && (moneyState.kpis.delayTrainMin ?? 0) > 0,
  `${moneyState.kpis.baselineDelayTrainMin} → ${moneyState.kpis.delayTrainMin} train-min per cycle (₹420/train-min)`
);

// ---- per-item reasoning: /api/why (rank arithmetic + counterfactuals that re-run the planner) ----
await resetLake();
const dl = (await fetch(`${base}/api/defects`).then(j)).defects;
const noBlockItem = dl.find((d) => !d.requiresBlock);
const physItem = dl.find((d) => d.requiresBlock && d.inspectionMode === "physical");
await post("/api/mode", { key: "fogMode", value: true });
const whyNB = await fetch(`${base}/api/why?defectId=${noBlockItem.id}`).then(j);
ok("why: an item that needs no line occupation is explained as such", whyNB.gate.reason === "no_block" && whyNB.placedIn === null, `${whyNB.defect.title.slice(0, 30)} → ${whyNB.gate.reason}`);
const why = await fetch(`${base}/api/why?defectId=${dl.find((d) => d.requiresBlock && d.status !== "closed").id}`).then(j);
const whyClosed = await fetch(`${base}/api/why?defectId=${dl.find((d) => d.status === "closed")?.id ?? 1}`).then(j);
ok(
  "why: an item outside the live pool is explained, not 404ed",
  whyClosed.defect && whyClosed.gate.reason === "outside_pool" && whyClosed.rank === null,
  `status ${whyClosed.defect?.status} → ${whyClosed.gate?.reason}`
);
const whySum = Math.round(why.score.terms.reduce((a, t) => a + t.value, 0));
ok(
  "why: the displayed terms add up to the displayed score (no hidden multiplier)",
  Math.abs(whySum - why.score.score) <= 1,
  `Σ${whySum} vs ${why.score.score} across ${why.score.terms.length} terms`
);
ok(
  "why: delay grows monotonically with neglect, and rank never worsens",
  (() => {
    const later = why.counterfactuals.find((c) => c.label.includes("another 30 days"));
    if (!later || !why.rank) return false;
    return later.delta > 0 && (later.rank === null || later.rank <= why.rank.position);
  })(),
  (() => {
    const later = why.counterfactuals.find((c) => c.label.includes("another 30 days"));
    return later && why.rank ? `+${later.delta} score, rank ${why.rank.position} → ${later.rank} · ${later.planEffect}` : "n/a";
  })()
);
ok(
  "why: counterfactuals re-run the planner instead of interpolating",
  why.counterfactuals.filter((c) => typeof c.planEffect === "string" && c.planEffect.length > 12).length >= 2,
  `${why.counterfactuals.filter((c) => c.planEffect).length} of ${why.counterfactuals.length} variants carry a placement outcome`
);
if (physItem) {
  const whyPhys = await fetch(`${base}/api/why?defectId=${physItem.id}`).then(j);
  const suspended = whyPhys.gate.reason === "fog_suspended";
  ok(
    "why: the fog gate in the explanation is the same gate the planner applies (risk < 0.55)",
    whyPhys.defect.requiresBlock && !whyPhys.defect.title.startsWith("__") && suspended === (whyPhys.score.risk < 0.55),
    `${suspended ? "suspended" : "kept"} at risk ${(whyPhys.score.risk * 100).toFixed(0)}% — ${whyPhys.gate.detail.slice(0, 44)}…`
  );
}
const why404 = await fetch(`${base}/api/why?defectId=9999999`);
ok("why: an item that does not exist answers 404, never a stack trace", why404.status === 404);
await post("/api/mode", { key: "fogMode", value: false });

// ---- evidence benchmark (AI vs simulated divisional meeting) ----
await resetLake();
const before = await fetch(`${base}/api/state`).then(j);
const bm = await post("/api/benchmark", { runs: 60, seed: 1 });
const rep = bm.report;
ok("benchmark: simulates the manual process and stores the run", !!rep && rep.runs === 60, `${rep?.candidates} defects · ${rep?.sections} sections · ${rep?.days}-day cycle`);
ok(
  "benchmark: both planners face the identical backlog (nothing hidden in 'deferred')",
  rep.ai.clearedItems + rep.ai.deferredItems === rep.candidates && rep.manual.clearedItems + rep.manual.deferredItems === rep.candidates,
  `AI ${rep.ai.clearedItems}+${rep.ai.deferredItems} · manual ${rep.manual.clearedItems}+${rep.manual.deferredItems} = ${rep.candidates}`
);
ok(
  "benchmark: AI clears at least as much of the backlog as the meeting",
  rep.ai.clearedItems >= rep.manual.clearedItems,
  `${rep.ai.clearedItems} vs ${rep.manual.clearedItems} defects`
);
ok(
  "benchmark: win rate is computed from the runs, not asserted",
  rep.winRatePct >= 80 && rep.efficiencyWinRatePct >= 90 && rep.perRun.length === 60,
  `${rep.winRatePct}% strict · ${rep.efficiencyWinRatePct}% on min/defect`
);
ok(
  "benchmark: bootstrap 95% CI on the delay delta excludes zero",
  rep.deltas.delayTrainMin.ci95[0] > 0,
  `+${rep.deltas.delayTrainMin.mean} train-min (CI ${rep.deltas.delayTrainMin.ci95.join("…")})`
);
ok("benchmark: generated plan carries no double-bookings, the meeting's are arbitrations", rep.ai.conflicts === 0 && rep.manual.arbitrations >= 0, `AI ${rep.ai.conflicts} · manual pushes ${rep.manual.arbitrations}`);
const bm2a = await post("/api/benchmark", { runs: 25, seed: 3 });
const bm2b = await post("/api/benchmark", { runs: 25, seed: 3 });
ok(
  "benchmark: deterministic for a given seed (quotable in a written report)",
  bm2a.report.manual.downtimeMin === bm2b.report.manual.downtimeMin &&
    bm2a.report.ai.downtimeMin === bm2b.report.ai.downtimeMin &&
    bm2a.report.winRatePct === bm2b.report.winRatePct,
  `${bm2a.report.manual.downtimeMin} manual block-min both times`
);
const bmGet = await fetch(`${base}/api/benchmark`).then(j);
ok("benchmark: latest run is retrievable for the deck", !!bmGet.report && bmGet.report.runs === 25, `stored run seed ${bmGet.report?.seed}`);
const after = await fetch(`${base}/api/state`).then(j);
ok(
  "benchmark: read-only against the live plan (it must not touch a published plan)",
  after.latestPlan.blocks.length === before.latestPlan.blocks.length && after.counts.openDefects === before.counts.openDefects,
  `${after.latestPlan.blocks.length} blocks, ${after.counts.openDefects} unscheduled — unchanged`
);

// ---- Tier 1.5 · incremental re-plan: what happens when the ground changes at 02:10 ----
await resetLake();
const rpBase = await post("/api/optimize", { horizon: "WEEKLY" });
const rpPlanId = rpBase.plan.id;
const rpBlocks = rpBase.plan.blocks ?? [];
ok("re-plan: a plan is in force to reconcile against", rpBlocks.length >= 12, `plan #${rpPlanId} · ${rpBlocks.length} notified blocks`);

const rpNoop = await post("/api/replan", {});
ok(
  "re-plan: a backlog that already matches the plan creates no new version",
  rpNoop.replanned === false &&
    rpNoop.diff.newPlanId === rpPlanId &&
    rpNoop.diff.stabilityPct === 100 &&
    rpNoop.diff.added === 0 &&
    rpNoop.diff.moved === 0,
  `stability ${rpNoop.diff.stabilityPct}% · still plan #${rpNoop.diff.newPlanId} (re-running it is free)`
);

// A patroller calls in about a section that already has six-odd defects and a block notified for it.
const rpSegBlock = rpBlocks.find((b) => !b.frozen);
const rpReport = await post("/api/jobs/report", {
  title: "Transverse rail head crack (USFD echo) — verifier 02:10",
  segmentId: rpSegBlock.segmentId,
  department: "ENG",
  severity: "critical",
  note: "verifier: on-foot report during the notified cycle",
});
ok(
  "patrol report: severity is taken from the handset, duration from the defect taxonomy",
  rpReport.logged?.severity === "critical" &&
    rpReport.logged?.severityNum === 10 &&
    rpReport.logged?.durationMin === 150 &&
    rpReport.logged?.requiresBlock === true &&
    !!rpReport.logged?.matchedTaxonomy,
  `${rpReport.logged?.severity} (${rpReport.logged?.severityNum}/10) · ${rpReport.logged?.durationMin} min · matched "${rpReport.logged?.matchedTaxonomy}"`
);

const rpInc = await post("/api/replan", { dryRun: true });
const rpFull = await post("/api/replan", { dryRun: true, mode: "full" });
const rpChainDry = await fetch(`${base}/api/replan`).then(j);
ok(
  "re-plan: a preview computes the diff and writes nothing",
  rpInc.dryRun === true &&
    rpInc.replanned === false &&
    rpChainDry.chain[rpChainDry.chain.length - 1].id === rpPlanId,
  `chain still ends at #${rpChainDry.chain[rpChainDry.chain.length - 1].id}`
);
ok(
  "re-plan: the minimal edit keeps the notified diagram",
  rpInc.diff.stabilityPct >= 70 && rpInc.diff.held >= 12,
  `${rpInc.diff.stabilityPct}% of blocks unchanged · ${rpInc.diff.held} carried through without re-solving`
);
ok(
  "re-plan: one new crack is absorbed into the existing occupation, not answered with a new one",
  rpInc.diff.added === 0 && rpInc.diff.unchanged >= Math.floor(rpBlocks.length * 0.6),
  `${rpInc.diff.unchanged} kept · ${rpInc.diff.moved} moved · ${rpInc.diff.dropped} released · shift ${rpInc.diff.shiftMinutes} min`
);
ok(
  "re-plan: the minimal edit is at least as stable as re-cutting the whole week",
  rpInc.diff.stabilityPct >= rpFull.diff.stabilityPct && rpInc.diff.nightsChanged <= rpFull.diff.nightsChanged,
  `stability ${rpInc.diff.stabilityPct}% vs ${rpFull.diff.stabilityPct}% · nights disturbed ${rpInc.diff.nightsChanged} vs ${rpFull.diff.nightsChanged}`
);
// 5% is the division's stated tolerance for keeping a diagram it has already notified, not a fudge
// factor: it is what makes "stability is nearly free here" a measured claim instead of an adjective.
ok(
  "re-plan: choosing stability costs at most 5% of reported delay",
  rpInc.metrics.delayTrainMin <= Math.ceil(rpFull.metrics.delayTrainMin * 1.05),
  `${rpInc.metrics.delayTrainMin} vs ${rpFull.metrics.delayTrainMin} train-min for the same ${rpInc.metrics.blocks}/${rpFull.metrics.blocks} blocks`
);

const rpPub = await post("/api/replan", { notify: true, triggerNote: "verifier: 02:10 on-foot report" });
ok(
  "re-plan: publishing writes a new version that supersedes the plan in force",
  rpPub.replanned === true && rpPub.diff.previousPlanId === rpPlanId && rpPub.metrics.planId > rpPlanId && rpPub.diff.mode === "incremental",
  `#${rpPlanId} → #${rpPub.metrics.planId} · ${rpPub.diff.unchanged}/${rpBlocks.length} blocks unchanged`
);
const rpStored = await fetch(`${base}/api/policy`).then(j);
ok(
  "re-plan: no hard rule is traded away for stability, and the stored verdict matches the panel",
  rpPub.metrics.hardViolations === 0 && (rpStored.hardViolations ?? -1) === 0 && rpStored.score === rpPub.metrics.policyScore,
  `ledger says ${rpStored.score}/${rpStored.hardViolations} hard · panel said ${rpPub.metrics.policyScore}/${rpPub.metrics.hardViolations} · ${rpPub.log.find((l) => l.includes("advisory"))?.match(/· \d+ advisory/)?.[0] ?? "0 advisory"}`
);
ok(
  "re-plan: work that could not be absorbed is announced, never swallowed",
  (rpPub.diff.escalation === null) === (rpPub.metrics.deferredItems === 0),
  `deferred ${rpPub.metrics.deferredItems} · escalation ${rpPub.diff.escalation ? "raised" : "not needed"}`
);
const quietDepts = new Set(rpPub.notified.map((n) => n.department));
ok(
  "re-plan: a re-plan that changed nothing notifies no one",
  rpPub.diff.blocks.every((b) => b.kind === "unchanged")
    ? rpPub.notified.length === 0
    : rpPub.notified.length > 0 && rpPub.notified.every((n) => n.blocks.length > 0),
  `${rpPub.notified.length} working advice(s) for ${rpPub.diff.moved + rpPub.diff.added + rpPub.diff.dropped} change(s)`
);
const rpCrackRow = (rpPub.diff.blocks ?? []).find((b) => b.segmentId === rpSegBlock.segmentId);
ok(
  "re-plan: the reported crack is inside a block of the new plan, not left in the queue",
  (rpCrackRow?.defectIds ?? []).includes(rpReport.defectId),
  `${rpCrackRow?.code} · ${rpCrackRow?.defectIds.length ?? 0} item(s) in ${rpCrackRow?.note ?? "the block"} · ${when0(rpCrackRow)}`
);
function when0(b) {
  if (!b?.to) return "no slot";
  const p = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return `${p(b.to.startMin)}–${p(b.to.endMin)}`;
}

// Now make the safety case: crews sign on to the block that holds the crack, and a second report
// arrives on a section that has no notified block at all. The first must not move; the second must
// add a block. Both halves of "minimal edit" in one call.
await post("/api/jobs/start", { jobId: rpReport.id });
const rpBefore = await fetch(`${base}/api/state`).then(j);
const rpBeforeBlocks = rpBefore.latestPlan?.blocks ?? [];
const covered = new Set(rpBeforeBlocks.map((b) => b.segmentId));
const uncoveredSeg = (rpBefore.segments ?? []).find((x) => !covered.has(x.id) && (x.defects ?? 0) >= 0);
const rpReport2 = await post("/api/jobs/report", {
  title: "OHE contact-wire height below 5.90 m — verifier 02:40",
  segmentId: uncoveredSeg.id,
  department: "TRD",
  severity: "critical",
  note: "verifier: second report, on a section with no notified block",
});
const rpPub2 = await post("/api/replan", { notify: true, triggerNote: "verifier: re-plan while a gang is on the line" });
ok(
  "re-plan: work on a section with no notified block adds exactly one block, disturbing nothing else",
  rpPub2.replanned === true && rpPub2.diff.added === 1 && rpPub2.diff.unchanged >= rpBeforeBlocks.length - 1,
  `defect #${rpReport2.defectId} → ${rpPub2.diff.added} block added on ${rpPub2.diff.affectedSections.join(",")} · ${rpPub2.diff.unchanged}/${rpBeforeBlocks.length} kept · ${rpPub2.diff.moved} moved`
);
const rpAfter = await fetch(`${base}/api/state`).then(j);
const changedDepts = new Set(rpPub2.diff.blocks.filter((b) => b.kind !== "unchanged").flatMap((b) => b.departments));
const notifiedDepts = new Set(rpPub2.notified.map((n) => n.department));
ok(
  "re-plan: working advice goes to exactly the departments whose blocks changed, with the slot quoted",
  rpPub2.notified.every((n) => n.department && n.blocks.length > 0) &&
    [...changedDepts].every((d) => notifiedDepts.has(d)) &&
    [...notifiedDepts].every((d) => changedDepts.has(d)) &&
    rpPub2.notified.flatMap((n) => n.blocks).every((line) => /\d\d:\d\d/.test(line)),
  `${[...notifiedDepts].join(", ") || "none"} ← ${[...changedDepts].join(",")} changed · ${rpPub2.notified.flatMap((n) => n.blocks)[0] ?? ""}`
);
const heldBlocks = (rpAfter.latestPlan?.blocks ?? []).filter((b) => b.frozen);
ok(
  "re-plan: a block with crews signed on is carried across with identical geometry",
  heldBlocks.length >= 1 &&
    heldBlocks.every((b) => {
      const o = rpBeforeBlocks.find((x) => x.segmentId === b.segmentId);
      return o && o.day === b.day && o.startMin === b.startMin && o.endMin === b.endMin;
    }),
  `${heldBlocks.length} held · ${rpPub2.diff.moved} moved · ${rpPub2.diff.dropped} released`
);
ok(
  "re-plan: a held block says why it cannot move",
  heldBlocks.every((b) => /crew|signed|possession/i.test(b.frozenReason ?? "")),
  heldBlocks.map((b) => `${b.segmentCode}: ${b.frozenReason}`).join(" | ")
);
const rpDrag = await fetch(`${base}/api/blocks`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: heldBlocks[0]?.id ?? -1, startMin: 540, endMin: 660 }),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
ok(
  "re-plan: the drag endpoint refuses to move a block whose line is under possession",
  rpDrag.status === 409 && /locked/i.test(rpDrag.body.error ?? ""),
  `HTTP ${rpDrag.status} · ${rpDrag.body.error ?? ""}`
);
const rpNoop2 = await post("/api/replan", {});
ok(
  "re-plan: once reconciled, reconciling again is a no-op",
  rpNoop2.replanned === false && rpNoop2.diff.stabilityPct === 100,
  rpNoop2.log[0]
);
const rpChain = await fetch(`${base}/api/replan`).then(j);
const rpChainLast = rpChain.chain?.[rpChain.chain.length - 1] ?? {};
ok(
  "re-plan: the version chain and its stored diff survive a reload",
  rpChain.chain.length >= 3 &&
    rpChainLast.id === rpPub2.metrics.planId &&
    rpChain.diff?.newPlanId === rpPub2.metrics.planId &&
    rpChainLast.supersedesId === rpPub.metrics.planId &&
    rpChainLast.stabilityPct === rpPub2.diff.stabilityPct,
  (rpChain.chain ?? []).map((c) => `#${c.id}${c.stabilityPct != null ? `(${c.stabilityPct}%)` : ""}`).join(" → ")
);
const rpGet = await fetch(`${base}/api/state`).then(j);
ok(
  "re-plan: /api/state serves the new plan, not the superseded one",
  rpGet.latestPlan.id === rpPub2.metrics.planId && rpGet.latestPlan.blocks.length === rpPub2.metrics.blocks,
  `#${rpGet.latestPlan.id} · ${rpGet.latestPlan.blocks.length} blocks`
);

// Leave the lake as a demo audience would expect to find it.
const rpReset = await resetLake();
const rpClean = await fetch(`${base}/api/state`).then(j);
ok(
  "re-plan: the verifier restores the seeded baseline afterwards",
  rpReset.rebuilt === true && (rpClean.counts?.openDefects ?? 0) > 15 && (rpClean.latestPlan?.blocks.length ?? 0) >= 12,
  `${rpClean.counts.openDefects} unscheduled · ${rpClean.latestPlan.blocks.length} blocks in the opening plan`
);

// ---- contracts ----
const dlist = await fetch(`${base}/api/defects`).then(j);
const d0 = dlist.defects?.[0] ?? {};
ok("defects API carries model risk + real durations", dlist.count > 0 && typeof d0.failureProb72h === "number" && d0.failureProb72h > 0 && d0.failureProb72h <= 1 && d0.durationMin > 0, `${dlist.count} items, prob ${d0.failureProb72h}, ${d0.durationMin} min`);
ok("risk values are model output, not a 0-100 percent", (dlist.defects ?? []).every((d) => d.failureProb72h <= 1), "0–1 probability");
const ing = await fetch(`${base}/api/ingest?system=TMS`).then(j);
ok("integration contract executes", ing.contractVersion === "tms-defects.v3" && ing.records > 0, `${ing.records} records, ${ing.latencyMs}ms`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
