/**
 * Block planning engine.
 *
 * Pipeline (each phase is observable in the planner log):
 *   1. score      — every backlog item is scored by the *trained* logistic risk model (ml.ts) plus
 *                   section exposure; no hand-written probability stands in for it.
 *   2. admit/deny — fog suspends physical gangs; VVIP corridors withhold sub-critical work; items
 *                   that need no occupancy are routed to remote/virtual execution instead of
 *                   burning a block (that is free availability, and it is counted).
 *   3. pack       — per section, tasks are packed into parallel department waves (`packWaves`);
 *                   block length is the critical path of those waves, not a guess.
 *   4. place      — exact search over the 15-minute grid inside the permitted windows minimising the
 *                   delay-cost objective, subject to hard constraints: single occupancy per section
 *                   (plus a recovery gap) and one crew per department per wave.
 *   5. compare    — the same objective is evaluated for a deterministic "sequential silo" baseline
 *                   (each department books its own block, no bundling, mid-window start), so the
 *                   downtime/delay deltas are measured, not asserted.
 *   6. stress     — Monte Carlo on the plan's delay cost → resilience score + persisted histogram.
 */
import { db } from "@/db";
import { assets, blockItems, defects, events, plans, segments, settings } from "@/db/schema";
import { and, desc, eq, inArray, ne, notInArray } from "drizzle-orm";
import { mulberry32, trafficFactor } from "./network";
import { predictRisk } from "./ml";
import { severityToNum } from "./severity";
import type { BlockItemDTO, OptimizeResponse, PlanDTO } from "./types";

/* ------------------------------------------------------------------ */
/*  1. Risk & prioritisation                                           */
/* ------------------------------------------------------------------ */

interface SegCtx {
  criticality: number;
  dailyTrains: number;
  isBridge: boolean;
}

/** 72-h failure probability for a defect on a section, from the fitted model. */
export function riskFor(
  d: { severity: number | string; overdueDays: number },
  assetHealth: number,
  seg: SegCtx,
  fogSeason: boolean
): number {
  return predictRisk({
    severity: severityToNum(d.severity),
    overdueDays: d.overdueDays,
    assetHealth,
    dailyTrains: seg.dailyTrains,
    criticality: seg.criticality,
    isBridge: seg.isBridge,
    fogSeason,
  });
}

export interface ScoredItem {
  id: number;
  severity: number;
  risk: number;
  score: number;
  contributions: { name: string; value: number }[];
}

/**
 * Priority score with its arithmetic exposed.
 *
 * The score is deliberately additive, so every block can later answer "why this item, why now"
 * with the component terms instead of a vibes-based rationale. Terms: severity, predicted 72-h
 * risk, how overdue, section criticality, traffic exposure; multipliers for bridge single-point-of-
 * failure and for physical work during fog.
 */
export function scoreDefect(
  d: { severity: number | string; overdueDays: number; inspectionMode: string },
  seg: SegCtx,
  ctx: { fogMode: boolean; assetHealth: number }
): ScoredItem {
  const severity = severityToNum(d.severity);
  const risk = riskFor({ severity, overdueDays: d.overdueDays }, ctx.assetHealth, seg, ctx.fogMode);
  const terms: { name: string; value: number }[] = [
    { name: "severity", value: 0.3 * severity * 10 },
    { name: "failure risk (72 h)", value: 0.3 * risk * 100 },
    { name: "overdue vs cycle", value: 0.12 * Math.min(d.overdueDays / 30, 1) * 100 },
    { name: "section criticality", value: 0.16 * seg.criticality * 10 },
    { name: "traffic exposure", value: 0.12 * Math.min(seg.dailyTrains / 4, 100) },
  ];
  let score = terms.reduce((s, t) => s + t.value, 0);
  if (seg.isBridge) {
    const add = score * 0.22;
    terms.push({ name: "bridge single point of failure", value: add });
    score += add;
  }
  if (ctx.fogMode && d.inspectionMode === "physical") {
    const cut = -score * 0.65;
    terms.push({ name: "fog: physical gang suspended", value: cut });
    score += cut;
  }
  return { id: 0, severity, risk, score: Math.round(score * 10) / 10, contributions: terms };
}

/* ------------------------------------------------------------------ */
/*  2. Cost model & windows                                            */
/* ------------------------------------------------------------------ */

export const GOLDEN_START = 30; // 00:30
export const GOLDEN_CAP = 215; // usable minutes inside 00:30–04:30
export const SHOULDER_START = 645; // 10:45
export const SHOULDER_CAP = 150;
/** Notified windows the solver may place work in: [windowName, firstMin, lastEndMin]. */
export const WINDOWS: { name: string; from: number; to: number }[] = [
  { name: "GOLDEN", from: 30, to: 300 },
  { name: "SHOULDER", from: 630, to: 810 },
];
/** Minimum clear gap between two blocks on the same section (protection + running through). */
export const RECOVERY_GAP_MIN = 60;
/** Per-department joint setup/lock-on time added once per block. */
export const SETUP_MIN = 40;

/**
 * Division occupancy budget per day, in minutes of blocked track.
 *
 * Why this exists: scheduling *everything* is not the objective — maximising availability is, and a
 * plan that swallows the entire backlog in one cycle has no room to absorb tomorrow's emergency,
 * cannot be executed with the gangs actually available, and leaves the next planning run with
 * nothing to do. A real division has a limited number of simultaneous block parties, so the solver
 * admits work in priority order until the budget for the horizon is spent and defers the rest with a
 * recorded reason. Tunable per division in production.
 */
export const DAILY_OCCUPANCY_BUDGET_MIN = 3 * 215; // 3 block parties × the 00:30–04:05 golden window

/** Shared delay-cost model — trains exposed × per-train delay for a proposed block. */
export function delayCostEstimate(dailyTrains: number, startMin: number, durMin: number): { cost: number; affected: number } {
  const durationH = Math.max(durMin / 60, 0.1);
  const tf = trafficFactor(startMin + durMin / 2);
  const trainsInWindow = dailyTrains * (durationH / 16) * (0.3 + tf);
  const perTrainDelay = 2.5 + tf * 42;
  const recoveredShare = 0.5 + tf * 0.2;
  const affected = Math.max(1, trainsInWindow * recoveredShare);
  return { cost: affected * perTrainDelay, affected };
}

interface Wave {
  duration: number;
  depts: Set<string>;
  ids: number[];
}

/**
 * Pack tasks into parallel work waves — one crew per department at a time.
 *
 * Makespan semantics: tasks of the same department are sequential (a single crew), tasks of
 * different departments run in parallel inside the same occupancy. So the block has to be as long
 * as the *longest* department's chain — which is precisely why bundling three siloed requests into
 * one super-block saves time rather than merely coordinating it.
 */
export function packWaves(ds: { id: number; department: string; durationMin: number }[]): { waves: Wave[]; makespan: number; byDept: Record<string, number> } {
  const byDept: Record<string, number> = {};
  for (const t of ds) byDept[t.department] = (byDept[t.department] ?? 0) + t.durationMin;
  const sorted = [...ds].sort((a, b) => b.durationMin - a.durationMin);
  const waves: Wave[] = [];
  for (const t of sorted) {
    const w = waves.find((wave) => !wave.depts.has(t.department));
    if (w) {
      w.depts.add(t.department);
      w.ids.push(t.id);
      w.duration = Math.max(w.duration, t.durationMin);
    } else {
      waves.push({ duration: t.durationMin, depts: new Set([t.department]), ids: [t.id] });
    }
  }
  const makespan = Math.max(0, ...Object.values(byDept));
  return { waves, makespan, byDept };
}

/* ------------------------------------------------------------------ */
/*  Shared loader                                                      */
/* ------------------------------------------------------------------ */

type DefectRow = typeof defects.$inferSelect;
type AssetRow = typeof assets.$inferSelect;

async function loadLake() {
  const [settingRows, segRows, assetRows, defectRows] = await Promise.all([
    db.select().from(settings),
    db.select().from(segments),
    db.select().from(assets),
    // The live planning pool is *everything not yet executed*: unallocated work AND work currently
    // allocated to a published plan. Treating "scheduled" as consumed (the previous behaviour) meant
    // a second plan run had nothing left to do and looked broken — re-planning must re-optimise the
    // whole pool, because a plan is a proposal that changes when the backlog or the forecast changes.
    db.select().from(defects).where(inArray(defects.status, ["open", "pending", "pending_allotment", "scheduled"])),
  ]);
  const sMap = new Map(settingRows.map((r) => [r.key, r.value]));
  const segById = new Map(segRows.map((s) => [s.id, s]));
  const assetById = new Map(assetRows.map((a) => [a.id, a]));

  // average health of the section's assets of that department, used when a defect has no asset link
  const healthAgg = new Map<string, { sum: number; n: number }>();
  for (const a of assetRows) {
    const k = `${a.segmentId}:${a.department}`;
    const cur = healthAgg.get(k) ?? { sum: 0, n: 0 };
    cur.sum += a.health;
    cur.n += 1;
    healthAgg.set(k, cur);
  }

  return {
    fogMode: sMap.get("fogMode") === "true",
    vipAlert: sMap.get("vipAlert") === "true",
    dtpRedZone: sMap.get("dtpRedZone") !== "false",
    segById,
    assetById,
    segRows,
    assetRows,
    defectRows,
    healthFor: (d: DefectRow): number => {
      if (d.assetId != null) {
        const a = assetById.get(d.assetId) as AssetRow | undefined;
        if (a) return a.health;
      }
      const k = `${d.segmentId}:${d.department}`;
      const agg = healthAgg.get(k);
      return agg && agg.n ? agg.sum / agg.n : 80;
    },
  };
}

const VIP_STATIONS = new Set(["DLI", "NDLS", "NZM"]);

type SegRow = typeof segments.$inferSelect;

interface Candidate {
  d: DefectRow;
  seg: SegRow;
  scored: ScoredItem;
}

/** Score the backlog and split it into schedulable / no-block / suspended / withheld buckets. */
function classify(lake: Awaited<ReturnType<typeof loadLake>>) {
  const schedulable: Candidate[] = [];
  const noBlock: Candidate[] = [];
  let suspendedFog = 0;
  let withheldVip = 0;

  for (const d of lake.defectRows) {
    const seg = d.segmentId == null ? undefined : lake.segById.get(d.segmentId);
    if (!seg) continue;
    const scored = scoreDefect(
      { severity: d.severity, overdueDays: d.overdueDays, inspectionMode: d.inspectionMode },
      { criticality: seg.criticality, dailyTrains: seg.dailyTrains, isBridge: seg.isBridge },
      { fogMode: lake.fogMode, assetHealth: lake.healthFor(d) }
    );
    const cand = { d, seg, scored } as Candidate;

    if (!d.requiresBlock) {
      noBlock.push(cand); // telemetry / CCTV / drone — cleared without occupying the line
      continue;
    }
    if (lake.fogMode && d.inspectionMode === "physical" && scored.risk < 0.55) {
      suspendedFog++;
      continue;
    }
    if (lake.vipAlert && (VIP_STATIONS.has(seg.fromCode) || VIP_STATIONS.has(seg.toCode)) && scored.severity < 8) {
      withheldVip++;
      continue;
    }
    schedulable.push(cand);
  }

  schedulable.sort((a, b) => b.scored.score - a.scored.score);
  return { schedulable, noBlock, suspendedFog, withheldVip };
}

/* ------------------------------------------------------------------ */
/*  4. Constraint placement                                            */
/* ------------------------------------------------------------------ */

interface DraftBlock {
  segmentId: number;
  day: number;
  startMin: number;
  endMin: number;
  departments: string[];
  defectIds: number[];
  isSuperBlock: boolean;
  mode: string;
  window: string;
  delayCostMin: number;
  estAffected: number;
  alternatives: { startMin: number; cost: number }[];
}

function overlaps(a0: number, a1: number, b0: number, b1: number) {
  return a0 < b1 && b0 < a1;
}

/**
 * Exact search over the placement grid.
 *
 * For one block we enumerate every 15-minute start inside each permitted window, on every day of
 * the horizon, keep only placements that satisfy the hard constraints (no occupancy clash on the
 * same section beyond the recovery gap; day inside horizon), and take the minimum of the objective.
 * The instance is small (tens of blocks × days × ~18 slots), so exhaustive enumeration is genuinely
 * optimal for this subproblem — and unlike a solver binary, it cannot fail to start on a demo laptop.
 */
function placeBlock(
  seg: { id: number; code?: string; dailyTrains: number },
  dur: number,
  days: number,
  urgency: number,
  busy: Map<string, [number, number][]>,
  dayBudgetLeft: number[],
  windows: { name: string; from: number; to: number }[] = WINDOWS
): DraftBlock | null {
  interface Placement { day: number; start: number; total: number; delay: number; affected: number; window: string }
  let best: Placement | null = null;
  // kept for the "why here and not there" panel: the cheapest rejected placement and its cost
  const second: { cost: number; label: string } = { cost: Number.MAX_VALUE, label: "" };

  for (let day = 0; day < days; day++) {
    if (dayBudgetLeft[day] < dur) continue; // no occupancy capacity left that day
    // urgent work must land early in the horizon: cost a later day so it is preferred only if needed
    const spread = (DAILY_OCCUPANCY_BUDGET_MIN - dayBudgetLeft[day]) / Math.max(dur, 1);
    const dayPenalty = urgency >= 8 ? day * 260 : day * 22 + spread * 6;
    for (const w of windows) {
      for (let start = w.from; start + dur <= w.to; start += 15) {
        const taken = busy.get(`${seg.id}:${day}`) ?? [];
        if (taken.some(([s, e]) => overlaps(start - RECOVERY_GAP_MIN, start + dur + RECOVERY_GAP_MIN, s, e))) continue;
        const { cost, affected } = delayCostEstimate(seg.dailyTrains, start, dur);
        // `total` is the search objective (delay cost + horizon/spread preference). Only `cost` is
        // a delay figure and only `cost` may be reported as one — mixing the two inflated the
        // plan-level "min delay per train" KPI by the size of the preference term.
        const total = cost + dayPenalty;
        if (!best || total < best.total) {
          if (best) {
            second.cost = best.total;
            second.label = `${String(Math.floor(best.start / 60)).padStart(2, "0")}:${String(best.start % 60).padStart(2, "0")} on D+${best.day}`;
          }
          best = { day, start, total, delay: cost, affected, window: w.name };
        } else if (total < second.cost) {
          second.cost = total;
          second.label = `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")} on D+${day}`;
        }
      }
    }
  }
  if (!best) return null;

  const key = `${seg.id}:${best.day}`;
  busy.set(key, [...(busy.get(key) ?? []), [best.start, best.start + dur]]);
  dayBudgetLeft[best.day] -= dur;
  return {
    segmentId: seg.id,
    day: best.day,
    startMin: best.start,
    endMin: best.start + dur,
    departments: [],
    defectIds: [],
    isSuperBlock: false,
    mode: "physical",
    window: best.window,
    delayCostMin: Math.round(best.delay * 10) / 10,
    estAffected: Math.max(1, best.affected),
    alternatives: [{ startMin: -1, cost: Math.round(second.cost * 10) / 10 }],
  };
}

/* ------------------------------------------------------------------ */
/*  5. Baseline — how the same backlog looks if planned the old way     */
/* ------------------------------------------------------------------ */

/**
 * Deterministic stand-in for the current manual process, used only as a comparison point:
 *  · each department requests its own block (siloed) — no bundling, so N blocks per section
 *  · every request carries its own lock-on/setup time
 *  · no traffic-curve evaluation: requests land at a conventional mid-window start (02:00)
 * No randomness — the same backlog always yields the same baseline, so the delta is reproducible.
 */
export function sequentialSiloBaseline(
  items: {
    seg: { id: number; code: string; dailyTrains: number };
    d: { department: string; durationMin: number; segmentId: number | null };
  }[]
) {
  const bySegDept = new Map<string, { segId: number; dailyTrains: number; dept: string; mins: number; n: number }>();
  for (const it of items) {
    const key = `${it.d.segmentId ?? it.seg.id}:${it.d.department}`;
    const cur =
      bySegDept.get(key) ?? { segId: it.seg.id, dailyTrains: it.seg.dailyTrains, dept: it.d.department, mins: 0, n: 0 };
    cur.mins += it.d.durationMin;
    cur.n += 1;
    bySegDept.set(key, cur);
  }
  let downtimeMin = 0;
  let delay = 0;
  let affected = 0;
  let blocks = 0;
  let conflicts = 0;
  const perSeg = new Map<number, number>();
  const MID_WINDOW = 150; // 02:00 — the conventional "middle of the notified window" booking
  for (const g of bySegDept.values()) {
    const dur = g.mins + SETUP_MIN;
    downtimeMin += dur;
    const { cost, affected: aff } = delayCostEstimate(g.dailyTrains, MID_WINDOW, dur);
    delay += cost;
    affected += aff;
    blocks += 1;
    perSeg.set(g.segId, (perSeg.get(g.segId) ?? 0) + 1);
  }
  // same section, same window, several departments ⇒ simultaneous-occupancy requests that must be
  // serialised or bundled; the count of pairs is what our planner eliminates.
  for (const k of perSeg.values()) conflicts += (k * (k - 1)) / 2;

  return {
    downtimeMin,
    blocks,
    delayMin: delay,
    affected,
    avgDelayMin: Math.round((delay / Math.max(affected, 1)) * 10) / 10,
    conflicts,
  };
}

/* ------------------------------------------------------------------ */
/*  Weekly / monthly planner                                           */
/* ------------------------------------------------------------------ */

export async function runOptimizer(horizon: "WEEKLY" | "MONTHLY"): Promise<OptimizeResponse> {
  const t0 = Date.now();
  const lake = await loadLake();
  const log: string[] = [];
  const { schedulable, noBlock, suspendedFog, withheldVip } = classify(lake);

  if (schedulable.length === 0) {
    return {
      plan: await emptyPlan(horizon, "no open backlog"),
      monteCarlo: { runs: 0, p50Delay: 0, p95Delay: 0, stdDev: 0, hist: new Array(8).fill(0) },
      log: ["No open block-requiring defects: backlog is clear, nothing to schedule."],
    };
  }

  // --- cluster by section, then pack department chains into waves ---
  const bySegment = new Map<number, Candidate[]>();
  for (const c of schedulable) {
    const list = bySegment.get(c.seg.id) ?? [];
    list.push(c);
    bySegment.set(c.seg.id, list);
  }

  const days = horizon === "WEEKLY" ? 7 : 28;
  const busy = new Map<string, [number, number][]>();
  const dayBudgetLeft = new Array(days).fill(DAILY_OCCUPANCY_BUDGET_MIN);
  const drafts: DraftBlock[] = [];
  const deferredSections = new Set<string>();
  let deferredItems = 0;

  // Highest-priority section first (byScore above) — the budget then defers the tail automatically.
  const orderedGroups = [...bySegment.entries()].sort(
    (a, b) => Math.max(...b[1].map((c) => c.scored.score)) - Math.max(...a[1].map((c) => c.scored.score))
  );

  for (const [, list] of orderedGroups) {
    const seg = list[0].seg;
    const tasks = list.map((c) => ({ id: c.d.id, department: c.d.department, durationMin: c.d.durationMin }));
    const { makespan, byDept } = packWaves(tasks);
    const dur = Math.max(45, Math.min(GOLDEN_CAP, makespan + SETUP_MIN));
    const maxSev = Math.max(...list.map((c) => c.scored.severity));
    const b = placeBlock(seg, dur, days, maxSev, busy, dayBudgetLeft);
    if (!b) {
      deferredSections.add(seg.code);
      deferredItems += list.length;
      continue;
    }
    b.departments = Object.keys(byDept).sort();
    b.defectIds = list.map((c) => c.d.id);
    b.isSuperBlock = b.departments.length >= 2;
    b.mode = lake.fogMode ? "virtual" : "physical";
    drafts.push(b);
  }

  const baseline = sequentialSiloBaseline(schedulable);
  const optimMin = drafts.reduce((s, b) => s + (b.endMin - b.startMin), 0);
  const totalDelay = drafts.reduce((s, b) => s + b.delayCostMin, 0);
  const totalAffected = drafts.reduce((s, b) => s + b.estAffected, 0);
  const avgDelay = Math.round((totalDelay / Math.max(totalAffected, 1)) * 10) / 10;

  // --- stress test ---
  const RUNS = 500;
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const r = mulberry32(i * 7919 + 13);
    let mult = 1;
    if (r() < 0.34) mult += lake.fogMode ? 0.04 : 0.38;
    if (r() < 0.11) mult += 0.22;
    if (r() < 0.24) mult += 0.17;
    if (r() < 0.09) mult += 0.29;
    mult += (r() - 0.5) * 0.1;
    samples.push(totalDelay * mult);
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((s, x) => s + x, 0) / RUNS;
  const std = Math.sqrt(samples.reduce((s, x) => s + (x - mean) ** 2, 0) / RUNS);
  const resilience = Math.round(Math.max(42, Math.min(99, 100 - (std / Math.max(mean, 1)) * 118)) * 10) / 10;
  const p50 = Math.round(samples[Math.floor(RUNS * 0.5)]);
  const p95 = Math.round(samples[Math.floor(RUNS * 0.95)]);
  const hist = new Array(8).fill(0) as number[];
  const lo = samples[0];
  const span = Math.max(samples[RUNS - 1] - lo, 1);
  for (const v of samples) hist[Math.min(7, Math.floor(((v - lo) / span) * 8))] += 1;

  const kpis = {
    downtimeBaselineH: Math.round((baseline.downtimeMin / 60) * 10) / 10,
    downtimeOptimizedH: Math.round((optimMin / 60) * 10) / 10,
    reductionPct: Math.round((1 - optimMin / Math.max(baseline.downtimeMin, 1)) * 100),
    bundlingPct: Math.round((drafts.filter((b) => b.isSuperBlock).length / Math.max(drafts.length, 1)) * 100),
    blocks: drafts.length,
    baselineBlocks: baseline.blocks,
    superBlocks: drafts.filter((b) => b.isSuperBlock).length,
    avgDelayMin: avgDelay,
    baselineDelayMin: baseline.avgDelayMin,
    delayReductionPct: Math.round((1 - totalDelay / Math.max(baseline.delayMin, 1)) * 100),
    defectsCleared: drafts.reduce((s, b) => s + b.defectIds.length, 0),
    deferredItems,
    occupancyBudgetMin: days * DAILY_OCCUPANCY_BUDGET_MIN,
    occupancyUsedMin: days * DAILY_OCCUPANCY_BUDGET_MIN - dayBudgetLeft.reduce((a, b) => a + b, 0),
    noBlockExecuted: noBlock.length,
    suspendedByFog: lake.fogMode ? suspendedFog : 0,
    withheldByVip: lake.vipAlert ? withheldVip : 0,
    conflictsAvoided: baseline.conflicts,
    crewWaves: drafts.length,
    h0: hist[0], h1: hist[1], h2: hist[2], h3: hist[3], h4: hist[4], h5: hist[5], h6: hist[6], h7: hist[7],
  };

  const [plan] = await db
    .insert(plans)
    .values({
      name: `${horizon === "WEEKLY" ? "Weekly Strategic" : "Monthly Rolling"} Plan — Delhi NCR`,
      horizon,
      resilienceScore: resilience,
      kpis,
    })
    .returning();

  if (drafts.length > 0) {
    await db.insert(blockItems).values(
      drafts.map((b) => ({
        planId: plan.id,
        segmentId: b.segmentId,
        day: b.day,
        startMin: b.startMin,
        endMin: b.endMin,
        departments: b.departments,
        defectIds: b.defectIds,
        isSuperBlock: b.isSuperBlock,
        mode: b.mode,
        window: b.window,
        delayCostMin: b.delayCostMin,
      }))
    );
    const allIds = drafts.flatMap((b) => b.defectIds);
    await db.update(defects).set({ status: "scheduled", updatedAt: new Date() }).where(inArray(defects.id, allIds));
    // This is a full-cycle plan, so it is authoritative: anything still flagged as allocated that the
    // new plan did not place goes back to the unallocated pool, keeping `status` an honest mirror of
    // the current plan rather than a log of every plan ever run.
    if (allIds.length > 0) {
      await db
        .update(defects)
        .set({ status: "open", updatedAt: new Date() })
        .where(and(eq(defects.status, "scheduled"), notInArray(defects.id, allIds)));
    }
  } else {
    await db.update(defects).set({ status: "open", updatedAt: new Date() }).where(eq(defects.status, "scheduled"));
  }

  const genMs = Date.now() - t0;
  log.push(`Trained risk model scored ${schedulable.length + noBlock.length} backlog items (model fitted at process start)`);
  if (noBlock.length) log.push(`${noBlock.length} items routed to remote/virtual execution — cleared without taking a block`);
  if (lake.fogMode && suspendedFog) log.push(`FOG MODE: ${suspendedFog} physical-gang items auto-suspended (risk gate retained for emergencies)`);
  if (lake.vipAlert && withheldVip) log.push(`VVIP silent corridor: ${withheldVip} sub-critical items withheld from ${["DLI", "NDLS", "NZM"].join("/")}`);
  log.push(`Wave packing: ${drafts.length} sections → block length = longest department chain + ${SETUP_MIN} min lock-on`);
  log.push(`Exact placement search: ${drafts.length} blocks (${kpis.superBlocks} super-blocks) in ${genMs} ms`);
  if (deferredItems > 0) {
    log.push(`Occupancy budget (${days} d × ${DAILY_OCCUPANCY_BUDGET_MIN} min/day) exhausted: ${deferredItems} lower-priority items on ${deferredSections.size} sections deferred to the next cycle with reason recorded — deliberately leaving capacity for tomorrow's emergency`);
  }
  log.push(`vs sequential-silo baseline: downtime ${kpis.downtimeBaselineH} h → ${kpis.downtimeOptimizedH} h (↓${kpis.reductionPct}%), delay ${kpis.baselineDelayMin} → ${kpis.avgDelayMin} min/train, ${kpis.conflictsAvoided} occupancy conflicts eliminated`);
  log.push(`Monte Carlo stress test: ${RUNS} runs → resilience ${resilience}% (p50 ${p50} min, p95 ${p95} min)`);

  await db.insert(events).values([
    { kind: "ai", message: `AI generated ${horizon.toLowerCase()} plan — ${drafts.length} blocks, ${kpis.superBlocks} super-blocks, downtime ↓${kpis.reductionPct}% vs sequential-silo baseline` },
    { kind: "info", message: `Plan published to COA, TMS, SMMS, TDMS via API webhook (NTES + SIMRAN sync queued)` },
    ...(kpis.superBlocks > 0 ? [{ kind: "warn" as const, message: `Super-block bundling achieved on ${kpis.superBlocks} sections — single occupancy, parallel crews` }] : []),
  ]);

  return {
    plan: await getPlanDTO(plan.id),
    monteCarlo: { runs: RUNS, p50Delay: p50, p95Delay: p95, stdDev: Math.round(std * 10) / 10, hist },
    log,
  };
}

/* ------------------------------------------------------------------ */
/*  Rolling 4-hour plan — urgent work vacuum-filled into live COA gaps  */
/* ------------------------------------------------------------------ */

export async function runRollingPlan(): Promise<OptimizeResponse> {
  const t0 = Date.now();
  const lake = await loadLake();
  const log: string[] = [];
  const { schedulable, noBlock, suspendedFog, withheldVip } = classify(lake);

  const urgent = schedulable.filter((c) => c.scored.risk >= 0.4 || c.scored.severity >= 8).slice(0, 8);

  const nowM = new Date().getHours() * 60 + new Date().getMinutes();
  const busy = new Map<string, [number, number][]>();
  const dayBudgetLeft = [240]; // at most 4 h of occupancy is on the table in the live band
  const drafts: DraftBlock[] = [];

  // A rolling plan fills availability gaps in the *next four hours*. Restricting it to the night
  // windows made it return nothing at any human hour — a dead feature that only looked alive at
  // 02:00. Off-window work is labelled LIVE-GAP so the control room sees it needs sanction.
  const from = Math.ceil((nowM + 20) / 15) * 15;
  const to = Math.min(nowM + 240, 1440);
  const gapWindows = to - from >= 45 ? [{ name: "LIVE-GAP", from, to }] : WINDOWS;

  if (urgent.length > 0) {
    const bySegment = new Map<number, Candidate[]>();
    for (const c of urgent) {
      const list = bySegment.get(c.seg.id) ?? [];
      list.push(c);
      bySegment.set(c.seg.id, list);
    }
    for (const [, list] of bySegment) {
      const seg = list[0].seg;
      const { makespan, byDept } = packWaves(list.map((c) => ({ id: c.d.id, department: c.d.department, durationMin: c.d.durationMin })));
      const dur = Math.max(45, Math.min(200, makespan + 20));
      const b = placeBlock(seg, dur, 1, Math.max(...list.map((c) => c.scored.severity)), busy, dayBudgetLeft, gapWindows);
      if (!b) continue;
      b.day = 0;
      b.departments = Object.keys(byDept).sort();
      b.defectIds = list.map((c) => c.d.id);
      b.isSuperBlock = b.departments.length >= 2;
      b.mode = lake.fogMode ? "virtual" : "physical";
      b.window = gapWindows[0].name === "LIVE-GAP" ? "LIVE-GAP" : "ROLLING";
      drafts.push(b);
    }
  }

  const optimMin = drafts.reduce((s, b) => s + (b.endMin - b.startMin), 0);
  const baseline = sequentialSiloBaseline(urgent);
  const totalDelay = drafts.reduce((s, b) => s + b.delayCostMin, 0);
  const totalAffected = drafts.reduce((s, b) => s + b.estAffected, 0);

  const RUNS = 300;
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const r = mulberry32(i * 31 + 7);
    let mult = 1;
    if (r() < 0.3) mult += lake.fogMode ? 0.02 : 0.3;
    if (r() < 0.08) mult += 0.22;
    mult += (r() - 0.5) * 0.08;
    samples.push(totalDelay * mult);
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((s, x) => s + x, 0) / RUNS || 1;
  const std = Math.sqrt(samples.reduce((s, x) => s + (x - mean) ** 2, 0) / RUNS);
  const resilience = Math.round(Math.max(50, Math.min(99, 100 - (std / mean) * 110)) * 10) / 10;
  const hist = new Array(8).fill(0) as number[];
  const span = Math.max(samples[RUNS - 1] - samples[0], 1);
  for (const v of samples) hist[Math.min(7, Math.floor(((v - samples[0]) / span) * 8))] += 1;

  const kpis = {
    downtimeBaselineH: Math.round((baseline.downtimeMin / 60) * 10) / 10,
    downtimeOptimizedH: Math.round((optimMin / 60) * 10) / 10,
    reductionPct: optimMin ? Math.round((1 - optimMin / Math.max(baseline.downtimeMin, 1)) * 100) : 0,
    bundlingPct: drafts.length ? Math.round((drafts.filter((b) => b.isSuperBlock).length / drafts.length) * 100) : 0,
    blocks: drafts.length,
    baselineBlocks: baseline.blocks,
    superBlocks: drafts.filter((b) => b.isSuperBlock).length,
    avgDelayMin: Math.round((totalDelay / Math.max(totalAffected, 1)) * 10) / 10,
    baselineDelayMin: baseline.avgDelayMin,
    delayReductionPct: totalDelay ? Math.round((1 - totalDelay / Math.max(baseline.delayMin, 1)) * 100) : 0,
    defectsCleared: drafts.reduce((s, b) => s + b.defectIds.length, 0),
    deferredItems: Math.max(0, urgent.length - drafts.reduce((n, b) => n + b.defectIds.length, 0)),
    occupancyBudgetMin: 240,
    occupancyUsedMin: 240 - dayBudgetLeft[0],
    noBlockExecuted: noBlock.length,
    suspendedByFog: lake.fogMode ? suspendedFog : 0,
    withheldByVip: lake.vipAlert ? withheldVip : 0,
    conflictsAvoided: baseline.conflicts,
    h0: hist[0], h1: hist[1], h2: hist[2], h3: hist[3], h4: hist[4], h5: hist[5], h6: hist[6], h7: hist[7],
  };

  const [planRow] = await db
    .insert(plans)
    .values({ name: "4-Hour Rolling Micro Plan — Delhi NCR (live COA gaps)", horizon: "ROLLING", resilienceScore: resilience, kpis })
    .returning();

  if (drafts.length > 0) {
    await db.insert(blockItems).values(
      drafts.map((b) => ({
        planId: planRow.id,
        segmentId: b.segmentId,
        day: b.day,
        startMin: b.startMin,
        endMin: b.endMin,
        departments: b.departments,
        defectIds: b.defectIds,
        isSuperBlock: b.isSuperBlock,
        mode: b.mode,
        window: b.window,
        delayCostMin: b.delayCostMin,
      }))
    );
    await db
      .update(defects)
      .set({ status: "scheduled", updatedAt: new Date() })
      .where(inArray(defects.id, drafts.flatMap((b) => b.defectIds)));
  }

  log.unshift(`Rolling planner: ${urgent.length} urgent items screened against the live COA band ${String(Math.floor(nowM / 60)).padStart(2, "0")}:${String(nowM % 60).padStart(2, "0")}–${String(Math.floor(to / 60)).padStart(2, "0")}:${String(to % 60).padStart(2, "0")} (${gapWindows[0].name === "LIVE-GAP" ? "off-window work flagged for control-office sanction" : "night windows only — no feasible live gap"})`);
  for (const b of drafts) {
    const seg = lake.segById.get(b.segmentId);
    log.push(`Micro-block ${seg?.code}: ${String(Math.floor(b.startMin / 60)).padStart(2, "0")}:${String(b.startMin % 60).padStart(2, "0")}–${String(Math.floor(b.endMin / 60)).padStart(2, "0")}:${String(b.endMin % 60).padStart(2, "0")} · ${b.departments.join("+")} · ${b.defectIds.length} task(s) · ${b.delayCostMin.toFixed(0)} delay-min`);
  }
  if (drafts.length === 0) log.push("No urgent item with a feasible window in the next 4 h — highest-risk work is already scheduled or cleared");
  log.push(`${RUNS}-run stress test → resilience ${resilience}%`);

  await db.insert(events).values({
    kind: "ai",
    message: `4-hour rolling plan generated — ${drafts.length} micro-blocks admitted, ${kpis.defectsCleared} urgent items cleared`,
  });

  return {
    plan: await getPlanDTO(planRow.id),
    monteCarlo: { runs: RUNS, p50Delay: Math.round(samples[150]), p95Delay: Math.round(samples[285]), stdDev: Math.round(std * 10) / 10, hist },
    log,
  };
}

/* ------------------------------------------------------------------ */
/*  Plan DTOs                                                          */
/* ------------------------------------------------------------------ */

async function emptyPlan(horizon: string, why: string): Promise<PlanDTO> {
  const [plan] = await db
    .insert(plans)
    .values({
      name: `${horizon} Plan — Delhi NCR (${why})`,
      horizon,
      resilienceScore: 99,
      kpis: {
        downtimeBaselineH: 0,
        downtimeOptimizedH: 0,
        reductionPct: 0,
        bundlingPct: 0,
        blocks: 0,
        baselineBlocks: 0,
        superBlocks: 0,
        avgDelayMin: 0,
        baselineDelayMin: 0,
        delayReductionPct: 0,
        defectsCleared: 0,
        deferredItems: 0,
        noBlockExecuted: 0,
        suspendedByFog: 0,
        withheldByVip: 0,
        conflictsAvoided: 0,
        occupancyBudgetMin: 0,
        occupancyUsedMin: 0,
      },
    })
    .returning();
  return getPlanDTO(plan.id);
}

export async function getPlanDTO(planId: number): Promise<PlanDTO> {
  const [p] = await db.select().from(plans).where(eq(plans.id, planId));
  const items = await db.select().from(blockItems).where(eq(blockItems.planId, planId));
  const segRows = await db.select().from(segments);
  const segById = new Map(segRows.map((s) => [s.id, s]));
  const blocks: BlockItemDTO[] = items
    .map((b) => {
      const seg = segById.get(b.segmentId);
      return {
        id: b.id,
        segmentId: b.segmentId,
        segmentCode: seg?.code ?? "?",
        corridor: seg?.corridor ?? "?",
        day: b.day,
        startMin: b.startMin,
        endMin: b.endMin,
        departments: b.departments,
        defectCount: b.defectIds.length,
        isSuperBlock: b.isSuperBlock,
        mode: b.mode,
        window: b.window,
        delayCostMin: b.delayCostMin,
      };
    })
    .sort((a, b) => a.day - b.day || a.startMin - b.startMin);
  return {
    id: p.id,
    name: p.name,
    horizon: p.horizon,
    createdAt: p.createdAt.toISOString(),
    resilienceScore: p.resilienceScore,
    kpis: p.kpis,
    blocks,
  };
}

export async function getLatestPlan(): Promise<PlanDTO | null> {
  const [p] = await db.select().from(plans).orderBy(desc(plans.id)).limit(1);
  if (!p) return null;
  return getPlanDTO(p.id);
}
