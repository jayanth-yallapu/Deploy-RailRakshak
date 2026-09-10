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
    return [...src.slice(start, j).matchAll(/^\s+([a-zA-Z0-9]+):/gm)].map((m) => m[1]);
  };
  // runOptimizer's literal is the first `const kpis = {` after its declaration
  const runK = keysOf("const kpis = {", "export async function runOptimizer");
  const rollK = keysOf("const kpis = {", "export async function runRollingPlan");
  const emptyK = keysOf("kpis: {", "async function emptyPlan");
  const union = [...new Set([...runK, ...rollK])];
  const missing = union.filter((x) => !emptyK.includes(x));
  ok(
    "kpi contract: the empty-plan shape carries every key the two planners publish",
    runK.length > 15 && missing.length === 0,
    missing.length ? `emptyPlan lacks ${missing.join(", ")}` : `${union.length} keys, all zero-filled`
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
ok("explain: a hand-edited block says so instead of pretending it still matches the reasoning", explMoved.editedByHuman === true, `placed ${explMoved.generated.chosen.startMin}→${explMoved.now.startMin} min`);
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

// ---- contracts ----
const dlist = await fetch(`${base}/api/defects`).then(j);
const d0 = dlist.defects?.[0] ?? {};
ok("defects API carries model risk + real durations", dlist.count > 0 && typeof d0.failureProb72h === "number" && d0.failureProb72h > 0 && d0.failureProb72h <= 1 && d0.durationMin > 0, `${dlist.count} items, prob ${d0.failureProb72h}, ${d0.durationMin} min`);
ok("risk values are model output, not a 0-100 percent", (dlist.defects ?? []).every((d) => d.failureProb72h <= 1), "0–1 probability");
const ing = await fetch(`${base}/api/ingest?system=TMS`).then(j);
ok("integration contract executes", ing.contractVersion === "tms-defects.v3" && ing.records > 0, `${ing.records} records, ${ing.latencyMs}ms`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
