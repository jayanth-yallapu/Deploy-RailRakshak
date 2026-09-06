#!/usr/bin/env node
/**
 * RAIL RAKSHAK — deployment verifier.
 * Runs 15 invariant checks against the live API. Usage:
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

const state = await fetch(`${base}/api/state`).then(j);
ok("grid: 19 real stations", state.stations.length === 19, `${state.stations.length}`);
ok("grid: 23 sections incl. RRTS", state.segments.length === 23, `${state.segments.length}`);
ok("grid: real coords present", state.stations.every((s) => Math.abs(s.lat - 28.6) < 1 && Math.abs(s.lng - 77.2) < 0.6));
ok("live trains tracked", state.liveTrains.length > 0, `${state.liveTrains.length} in window`);
ok("model card: computed accuracy in sane band", state.modelCard.accuracy > 70 && state.modelCard.accuracy < 99, `${state.modelCard.accuracy}% / AUC ${state.modelCard.auc}`);
ok("model card: loss surface sane (AUC > 0.7)", state.modelCard.auc > 0.7);

const opt = await post("/api/optimize", { horizon: "WEEKLY" });
const k = opt.plan.kpis;
ok("optimizer produces blocks", k.blocks > 5, `${k.blocks}`);
ok("downtime reduced vs baseline", k.downtimeOptimizedH < k.downtimeBaselineH, `${k.downtimeBaselineH}→${k.downtimeOptimizedH}h`);
ok("bundling within [0,100]", k.bundlingPct >= 0 && k.bundlingPct <= 100, `${k.bundlingPct}%`);
ok("super-blocks exist", k.superBlocks > 0, `${k.superBlocks}`);
ok("monte carlo histogram sums to 500", opt.monteCarlo.hist.reduce((a, b) => a + b, 0) === 500, opt.monteCarlo.hist.join(","));

const roll = await post("/api/optimize", { horizon: "ROLLING" });
ok("rolling 4h plan: day-0 blocks only", roll.plan.blocks.every((b) => b.day === 0), `${roll.plan.blocks.length} blocks`);

const bridge = state.segments.find((s) => s.code === "NZM-ANVT");
const wi = await post("/api/whatif", { segmentId: bridge.id, durationH: 6, startMin: 540, superBlock: false });
ok("whatif: peak bridge closure rejected", wi.recommend === false, `net ₹${wi.netBenefit}`);
const wi2 = await post("/api/whatif", { segmentId: bridge.id, durationH: 2, startMin: 60, superBlock: true });
ok("whatif: golden-window super-block recommended", wi2.recommend === true, `net ₹${wi2.netBenefit}`);

const ing = await fetch(`${base}/api/ingest?system=TMS`).then(j);
ok("integration contract executes", ing.contractVersion === "tms-defects.v3" && ing.records > 0, `${ing.records} records, ${ing.latencyMs}ms`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
