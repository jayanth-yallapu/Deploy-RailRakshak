/**
 * AI-vs-manual planning benchmark.
 * ---------------------------------------------------------------------------
 * The brief claims divisional block allocation is done by hand, in a meeting, department by
 * department. To prove the optimizer is better we have to reproduce *that process*, not a strawman.
 * So each run simulates a divisional allocation meeting with the documented habits:
 *
 *   · work is tabled in the order each department's list arrived — no risk weighting across depts;
 *   · every department books its own occupation of a section (no bundling into a super-block);
 *   · the quoted duration carries allowance for lock-on/lock-off and slack (8–20 % padding);
 *   · the requested slot is the habitual mid-window start from the planner's notebook, not the
 *     lowest-impact hour of the cycle;
 *   · a department has one working gang per night, so it cannot be on two sections at once;
 *   · a double-booking is not rejected, it is pushed to the next available night ("arbitration").
 *
 * The AI plan is the product's own code path — `planPool` with default options, the same function
 * `runOptimizer` calls — so nothing is tuned to win. Both plans are then judged by the *same*
 * `scorePlan`, against the *same* physical constraints (one occupation per section per night, a
 * daily occupancy budget, the same candidate backlog). The only difference is the process.
 *
 * Also note what this file never does: it does not read or write the plan tables. A benchmark run
 * therefore cannot disturb a live plan — important, because this project's failure mode has been a
 * new feature breaking an existing page.
 */

import { db } from "@/db";
import { benchmarks } from "@/db/schema";
import { desc } from "drizzle-orm";
import { classify, loadLake, planPool, scorePlan, type PlanScore } from "./optimizer";
import { COST } from "./network";

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One plan's measured outcome. Every field is a physical quantity, not a modelled score. */
export interface CaseOutcome extends PlanScore {
  clearedItems: number;
  deferredItems: number;
  /** block-minutes of line occupation spent per defect actually cleared — the volume-neutral
   *  efficiency measure, so a plan that clears less work cannot look "leaner". */
  blockMinPerCleared: number;
  /** separate occupations the DRM must sanction and the COA must police, i.e. approvals per day. */
  occupations: number;
  arbitrations: number;
  crewNights: number;
  delayTrainMin: number;
  rupees: number;
}

export interface BenchmarkReport {
  ranAt: string;
  horizon: "WEEKLY" | "MONTHLY";
  days: number;
  runs: number;
  seed: number;
  candidates: number;
  sections: number;
  ai: CaseOutcome;
  manual: CaseOutcome;
  /** Share of simulated meetings in which the AI plan was at least as good, never worse, on every
   *  headline metric — the strict test. A plan that wins on delay but loses on coverage is not a win. */
  winRatePct: number;
  /** Same, judged on occupation-minutes-per-cleared-defect only: the looser test. */
  efficiencyWinRatePct: number;
  deltas: Record<string, { mean: number; unit: string; ci95: [number, number]; favour: "ai" | "manual" | "tie" }>;
  assumptions: string[];
  perRun: {
    seed: number;
    aiDowntimeMin: number;
    manualDowntimeMin: number;
    aiDelay: number;
    manualDelay: number;
    aiCleared: number;
    manualCleared: number;
    manualConflicts: number;
    manualArbitrations: number;
  }[];
}

function outcome(
  core: ReturnType<typeof planPool>,
  lake: { segById: Map<number, { dailyTrains: number }> },
  totalSections: number
): CaseOutcome {
  const sc = scorePlan(
    core.drafts.map((b) => ({
      segId: b.segmentId,
      day: b.day,
      startMin: b.startMin,
      endMin: b.endMin,
      dailyTrains: lake.segById.get(b.segmentId)?.dailyTrains ?? 60,
      depts: b.departments,
    })),
    totalSections
  );
  const cleared = core.drafts.reduce((n, b) => n + b.defectIds.length, 0);
  const byDayDept = new Set(core.drafts.map((b) => `${b.day}:${b.departments.join("+")}`));
  return {
    ...sc,
    clearedItems: cleared,
    deferredItems: core.deferredItems,
    blockMinPerCleared: Math.round((sc.downtimeMin / Math.max(cleared, 1)) * 10) / 10,
    occupations: sc.blocks,
    arbitrations: core.arbitrations,
    // one gang per department per night — this is what a silo booking actually costs in labour
    crewNights: byDayDept.size,
    delayTrainMin: Math.round(sc.delayMin),
    rupees: Math.round(sc.delayMin * COST.paxDelayPerMin),
  };
}

/** Percentile of a sorted array, linear-interpolated. */
function pct(sorted: number[], q: number) {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Bootstrap 95 % interval on the *mean paired delta*. Resampling the pairs (not the two groups
 * separately) keeps the comparison honest: each simulated meeting contributes one difference, so a
 * wide spread of human habits shows up as a wide interval instead of being averaged away.
 */
function bootCi(pairs: number[], rng: () => number, resamples = 2000): [number, number] {
  if (pairs.length === 0) return [0, 0];
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    for (let i = 0; i < pairs.length; i++) sum += pairs[Math.floor(rng() * pairs.length)];
    means.push(sum / pairs.length);
  }
  means.sort((a, b) => a - b);
  return [Math.round(pct(means, 0.025) * 10) / 10, Math.round(pct(means, 0.975) * 10) / 10];
}

export async function runBenchmark(
  opts: { runs?: number; horizon?: "WEEKLY" | "MONTHLY"; seed?: number } = {}
): Promise<BenchmarkReport> {
  const runs = Math.max(1, Math.min(500, opts.runs ?? 100));
  const horizon = opts.horizon === "MONTHLY" ? "MONTHLY" : "WEEKLY";
  const seed = Math.max(1, Math.min(999999, Math.round(opts.seed ?? 1)));
  const days = horizon === "MONTHLY" ? 28 : 7;

  const lake = await loadLake();
  const { schedulable } = classify(lake);
  if (schedulable.length === 0) throw new Error("no open backlog to plan — seed the lake first");

  // The product's own configuration, once: deterministic, no randomness, no tuning per run.
  const aiCore = planPool(schedulable, days, { fogMode: lake.fogMode });
  const ai = outcome(aiCore, lake, lake.segById.size);

  const perRun: BenchmarkReport["perRun"] = [];
  const pairs: Record<string, number[]> = {
    downtime: [],
    delay: [],
    blockMinPerCleared: [],
    occupations: [],
    crewNights: [],
    coverage: [],
  };
  let effWins = 0;
  let strictWins = 0;
  const manualAcc = { ...ai };

  for (let i = 0; i < runs; i++) {
    const rng = mulberry32(((seed * 7919 + i * 104729) >>> 0) || 1);
    const manualCore = planPool(schedulable, days, {
      fogMode: lake.fogMode,
      order: "arrival",
      bundle: false,
      placement: "conventional",
      paddingPct: 8 + Math.round(rng() * 12),
      rng,
    });
    const m = outcome(manualCore, lake, lake.segById.size);
    if (i === 0) Object.assign(manualAcc, m);
    else {
      manualAcc.downtimeMin += m.downtimeMin;
      manualAcc.delayMin += m.delayMin;
      manualAcc.affected += m.affected;
      manualAcc.avgDelayMin += m.avgDelayMin;
      manualAcc.blocks += m.blocks;
      manualAcc.superBlocks += m.superBlocks;
      manualAcc.bundlingPct += m.bundlingPct;
      manualAcc.conflicts += m.conflicts;
      manualAcc.coveragePct += m.coveragePct;
      manualAcc.sectionsCovered += m.sectionsCovered;
      manualAcc.clearedItems += m.clearedItems;
      manualAcc.deferredItems += m.deferredItems;
      manualAcc.blockMinPerCleared += m.blockMinPerCleared;
      manualAcc.occupations += m.occupations;
      manualAcc.arbitrations += m.arbitrations;
      manualAcc.crewNights += m.crewNights;
      manualAcc.delayTrainMin += m.delayTrainMin;
      manualAcc.rupees += m.rupees;
    }

    pairs.downtime.push(m.downtimeMin - ai.downtimeMin);
    pairs.delay.push(m.delayTrainMin - ai.delayTrainMin);
    pairs.blockMinPerCleared.push(m.blockMinPerCleared - ai.blockMinPerCleared);
    pairs.occupations.push(m.occupations - ai.occupations);
    pairs.crewNights.push(m.crewNights - ai.crewNights);
    pairs.coverage.push(ai.coveragePct - m.coveragePct);

    if (m.blockMinPerCleared > ai.blockMinPerCleared) effWins += 1;
    if (
      m.downtimeMin >= ai.downtimeMin &&
      m.delayTrainMin >= ai.delayTrainMin &&
      m.clearedItems <= ai.clearedItems &&
      m.coveragePct <= ai.coveragePct &&
      m.conflicts >= ai.conflicts
    )
      strictWins += 1;

    perRun.push({
      seed: seed * 7919 + i * 104729,
      aiDowntimeMin: ai.downtimeMin,
      manualDowntimeMin: m.downtimeMin,
      aiDelay: ai.delayTrainMin,
      manualDelay: m.delayTrainMin,
      aiCleared: ai.clearedItems,
      manualCleared: m.clearedItems,
      manualConflicts: m.conflicts,
      manualArbitrations: m.arbitrations,
    });
  }

  const mean = (v: number) => Math.round((v / runs) * 10) / 10;
  const manual: CaseOutcome = {
    ...manualAcc,
    downtimeMin: mean(manualAcc.downtimeMin),
    delayMin: mean(manualAcc.delayMin),
    affected: mean(manualAcc.affected),
    avgDelayMin: mean(manualAcc.avgDelayMin),
    blocks: mean(manualAcc.blocks),
    superBlocks: mean(manualAcc.superBlocks),
    bundlingPct: mean(manualAcc.bundlingPct),
    conflicts: mean(manualAcc.conflicts),
    coveragePct: mean(manualAcc.coveragePct),
    sectionsCovered: mean(manualAcc.sectionsCovered),
    clearedItems: mean(manualAcc.clearedItems),
    deferredItems: mean(manualAcc.deferredItems),
    blockMinPerCleared: mean(manualAcc.blockMinPerCleared),
    occupations: mean(manualAcc.occupations),
    arbitrations: mean(manualAcc.arbitrations),
    crewNights: mean(manualAcc.crewNights),
    delayTrainMin: mean(manualAcc.delayTrainMin),
    rupees: mean(manualAcc.rupees),
  };

  const rng = mulberry32((seed * 31337) >>> 0);
  const favour = (arr: number[]) => {
    const m = arr.reduce((s, v) => s + v, 0) / Math.max(arr.length, 1);
    return m > 0.5 ? "ai" : m < -0.5 ? "manual" : "tie";
  };
  const mk = (arr: number[], unit: string) => ({
    mean: mean(arr.reduce((s, v) => s + v, 0)),
    unit,
    ci95: bootCi(arr, rng).map((v) => Math.round(v * 10) / 10) as [number, number],
    favour: favour(arr) as "ai" | "manual" | "tie",
  });

  const report: BenchmarkReport = {
    ranAt: new Date().toISOString(),
    horizon,
    days,
    runs,
    seed,
    candidates: schedulable.length,
    sections: lake.segById.size,
    ai,
    manual,
    winRatePct: Math.round((strictWins / runs) * 100),
    efficiencyWinRatePct: Math.round((effWins / runs) * 100),
    deltas: {
      downtimeMin: mk(pairs.downtime, "block-minutes"),
      delayTrainMin: mk(pairs.delay, "train-minutes"),
      blockMinPerCleared: mk(pairs.blockMinPerCleared, "min/defect"),
      occupations: mk(pairs.occupations, "approvals"),
      crewNights: mk(pairs.crewNights, "gang-nights"),
      coveragePct: mk(pairs.coverage, "%-sections"),
    },
    assumptions: [
      `Backlog: the same ${schedulable.length} open block-requiring defects, on the same ${lake.segById.size} sections, for both planners.`,
      "Both plans obey the same physical rules: one occupation per section per night, one section closure at a time, the divisional daily occupancy budget, and the same recovery gap between occupations.",
      "Manual process is modelled from the PS description: department-silo lists in arrival order, one occupation per department, mid-window habitual start, 8–20 % duration padding, one gang per department per night, double-bookings resolved by pushing to the next night.",
      "Delay is measured as affected trains × per-train delay from the traffic curve at the booked minute, then costed at ₹420 per train-minute (COST.paxDelayPerMin) — no separate 'benchmark model'.",
      "The AI plan is deterministic, so it contributes no variance; the confidence interval describes how much the outcome depends on which manual habits showed up that week.",
      "This is a simulation of the documented process on seeded field data, not a measurement of past divisional meetings. It answers 'how much of this gap is the process, not the hardware' — a real A/B would need a division's actual ledger.",
    ],
    perRun,
  };

  await db.insert(benchmarks).values({ horizon, runs, seed, report: report as unknown as Record<string, unknown> });
  return report;
}

export async function getLatestBenchmark(): Promise<BenchmarkReport | null> {
  const [row] = await db.select().from(benchmarks).orderBy(desc(benchmarks.id)).limit(1);
  return (row?.report as unknown as BenchmarkReport) ?? null;
}
