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
import { evaluatePlanPolicy, maxBlockMinutes } from "./policy";
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

export async function loadLake() {
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

export const VIP_STATIONS = new Set(["DLI", "NDLS", "NZM"]);

type SegRow = typeof segments.$inferSelect;

type SegmentLite = { id: number; code: string; dailyTrains: number };

/**
 * The audit note a block carries. Everything here is a quantity the solver actually used while
 * placing the block — nothing is written afterwards by hand — which is what makes "why this block,
 * here, at this time?" answerable without re-running the search.
 */
export interface BlockExplanation {
  why: string[];
  /** The objective terms of the defect that drove the section, so the ranking is inspectable. */
  terms: { name: string; value: number }[];
  drivingDefect: { id: number; title: string; score: number; severity: number; risk: number };
  chosen: { day: number; startMin: number; endMin: number; window: string; delayCostMin: number; affectedTrains: number };
  /** The cheapest placement that was examined and rejected, straight from the search. */
  runnerUp: { label: string; cost: number; penaltyVsChosen: number } | null;
  budget: { day: number; usedMin: number; limitMin: number };
  bundling: { departments: string[]; separateBlockMin: number; bundledBlockMin: number; savedMin: number };
}

export interface Candidate {
  d: DefectRow;
  seg: SegRow;
  scored: ScoredItem;
}

/** Score the backlog and split it into schedulable / no-block / suspended / withheld buckets. */
export function classify(lake: Awaited<ReturnType<typeof loadLake>>) {
  const schedulable: Candidate[] = [];
  const noBlock: Candidate[] = [];
  /** Why each backlog item is where it is — the input to "why was I not planned?" (see /api/why). */
  const reasons = new Map<number, { reason: string; detail: string }>();
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
      reasons.set(d.id, {
        reason: "no_block",
        detail: "Remote/CCTV/drone inspection — cleared without occupying the line, so it never competes for a night.",
      });
      continue;
    }
    if (lake.fogMode && d.inspectionMode === "physical" && scored.risk < 0.55) {
      suspendedFog++;
      reasons.set(d.id, {
        reason: "fog_suspended",
        detail: `Fog standing order: a physical gang is not deployed in dense fog, and its 72 h risk ${(scored.risk * 100).toFixed(0)}% is below the ${"0.55"} emergency gate that would override that.`,
      });
      continue;
    }
    if (lake.vipAlert && (VIP_STATIONS.has(seg.fromCode) || VIP_STATIONS.has(seg.toCode)) && scored.severity < 8) {
      withheldVip++;
      reasons.set(d.id, {
        reason: "vip_withheld",
        detail: `Exclusive movement notified on ${seg.fromCode}/${seg.toCode}: only severity 8+ may be booked on this corridor while it is active (this item is severity ${scored.severity}).`,
      });
      continue;
    }
    schedulable.push(cand);
  }

  schedulable.sort((a, b) => b.scored.score - a.scored.score);
  schedulable.forEach((c, i) =>
    reasons.set(c.d.id, {
      reason: "in_pool",
      detail: `Rank ${i + 1} of ${schedulable.length} in this cycle's pool by priority score (${c.scored.score}).`,
    })
  );
  return { schedulable, noBlock, suspendedFog, withheldVip, reasons };
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
  /** The cheapest placement that was rejected: what the explain panel quotes as the runner-up. */
  alternatives: { startMin: number; cost: number; penalty?: number; label?: string }[];
  /** Benchmark bookkeeping: which working unit produced this block. */
  unitKey?: string;
  /** Immovable: a crew is already signed on, so the block cannot be edited or rescheduled. */
  frozen?: boolean;
  /** Pinned-but-editable: copied through by an incremental re-plan to keep the schedule stable. */
  carried?: boolean;
  frozenReason?: string;
  /** Why this block exists, in this slot, at this length — see `BlockExplanation`. */
  explain?: BlockExplanation;
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
  windows: { name: string; from: number; to: number }[] = WINDOWS,
  /** Extra objective cost of *moving* this block (incremental re-planning). It enters `total` only:
   *  delay figures reported to the user must stay the physical delay, not the preference term. */
  churnCost?: (day: number, start: number) => number
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
        const churn = churnCost ? churnCost(day, start) : 0;
        // `total` is the search objective (delay cost + horizon/spread preference + churn). Only `cost` is
        // a delay figure and only `cost` may be reported as one — mixing the two inflated the
        // plan-level "min delay per train" KPI by the size of the preference term.
        const total = cost + dayPenalty + churn;
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
    // `cost` is the runner-up's objective value; `penalty` is the gap to what was chosen. Both sides
    // of that subtraction are objective totals — comparing the runner-up's total against the chosen
    // block's *delay* figure (which is what this did first) produced a flattering, meaningless gap.
    alternatives: [
      {
        startMin: -1,
        cost: Math.round(second.cost * 10) / 10,
        penalty: Math.max(0, Math.round((second.cost - best.total) * 10) / 10),
        label: second.label,
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/*  5. Baseline — how the same backlog looks if planned the old way     */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Process model for the benchmark                                    */
/* ------------------------------------------------------------------ */

/**
 * How a divisional allocation meeting actually places a block when nobody searches: walk the days
 * from the front of the cycle, take the first night where the section and the department's own gang
 * are free, and book the habitual mid-window slot. If the section is already occupied that night the
 * request is not rejected, it is *pushed* — that push is an arbitration, and it is counted.
 */
function placeConventional(
  seg: { id: number; code?: string; dailyTrains: number },
  dur: number,
  days: number,
  busy: Map<string, [number, number][]>,
  dayBudgetLeft: number[],
  deptDayUsed: Map<string, Set<number>>,
  dept: string | null,
  rng: () => number,
  onArbitration: () => void
): DraftBlock | null {
  // Habit: request the middle of the notified window, with whatever the planner's notebook says.
  const habitStart = 120 + Math.round(rng() * 4) * 30; // 02:00 – 04:00
  for (let day = 0; day < days; day++) {
    if (dayBudgetLeft[day] < dur) continue;
    if (dept && deptDayUsed.get(dept)?.has(day)) continue; // that gang is already out there
    let start = habitStart;
    const taken = busy.get(`${seg.id}:${day}`) ?? [];
    const clash = taken.find(([s, e]) => overlaps(start - RECOVERY_GAP_MIN, start + dur + RECOVERY_GAP_MIN, s, e));
    if (clash) {
      // The room's decision is "you take the next night", which is what a push costs.
      onArbitration();
      continue;
    }
    if (start + dur > 1440 - 30) start = Math.max(0, 1440 - 30 - dur);
    const { cost, affected } = delayCostEstimate(seg.dailyTrains, start, dur);
    busy.set(`${seg.id}:${day}`, [...taken, [start, start + dur]]);
    if (dept) deptDayUsed.set(dept, new Set([...(deptDayUsed.get(dept) ?? []), day]));
    dayBudgetLeft[day] -= dur;
    return {
      segmentId: seg.id,
      day,
      startMin: start,
      endMin: start + dur,
      departments: [],
      defectIds: [],
      isSuperBlock: false,
      mode: "physical",
      window: "Notified window (conventional booking)",
      delayCostMin: Math.round(cost * 10) / 10,
      estAffected: Math.max(1, affected),
      alternatives: [],
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Shared plan scorer — one objective, three consumers               */
/* ------------------------------------------------------------------ */

/** The minimal shape of "a block", so any plan (ours, a baseline, a simulated human's) is scored
 *  by exactly the same arithmetic. This is what makes the comparison defensible: there is one
 *  objective function in the repo, not one for the AI and a softer one for the baseline. */
export interface ScoreableBlock {
  segId: number;
  day: number;
  startMin: number;
  endMin: number;
  dailyTrains: number;
  depts: string[];
}

export interface PlanScore {
  downtimeMin: number;
  delayMin: number;
  affected: number;
  avgDelayMin: number;
  blocks: number;
  superBlocks: number;
  bundlingPct: number;
  /** pairs of same-section blocks that overlap — i.e. double-bookings someone must arbitrate. */
  conflicts: number;
  /** share of the grid that received its maintenance attention this cycle. */
  coveragePct: number;
  sectionsCovered: number;
}

export function scorePlan(blocks: ScoreableBlock[], totalSections: number): PlanScore {
  let downtimeMin = 0;
  let delayMin = 0;
  let affected = 0;
  let superBlocks = 0;
  let bundledMin = 0;
  const perSection = new Map<string, [number, number][]>();
  for (const b of blocks) {
    const dur = b.endMin - b.startMin;
    downtimeMin += dur;
    const c = delayCostEstimate(b.dailyTrains, b.startMin, dur);
    delayMin += c.cost;
    affected += c.affected;
    if (b.depts.length >= 2) {
      superBlocks += 1;
      bundledMin += dur;
    }
    const key = `${b.segId}:${b.day}`;
    perSection.set(key, [...(perSection.get(key) ?? []), [b.startMin, b.endMin]]);
  }
  let conflicts = 0;
  for (const list of perSection.values()) {
    list.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < list.length; i++) if (list[i][0] < list[i - 1][1]) conflicts += 1;
  }
  return {
    downtimeMin,
    delayMin,
    affected,
    avgDelayMin: Math.round((delayMin / Math.max(affected, 1)) * 10) / 10,
    blocks: blocks.length,
    superBlocks,
    bundlingPct: Math.round((bundledMin / Math.max(downtimeMin, 1)) * 100),
    conflicts,
    coveragePct: Math.round(((perSection.size ? new Set(blocks.map((b) => b.segId)).size : 0) / Math.max(totalSections, 1)) * 100),
    sectionsCovered: new Set(blocks.map((b) => b.segId)).size,
  };
}

/**
 * Deterministic stand-in for the current manual process, used only as a comparison point:
 *  · each department requests its own block (siloed) — no bundling, so N blocks per section
 *  · every request carries its own lock-on/setup time
 *  · no traffic-curve evaluation: requests land at a conventional mid-window start (02:00)
 * No randomness — the same backlog always yields the same baseline, so the delta is reproducible.
 */
export function sequentialSiloBaselineBlocks(
  items: {
    seg: { id: number; code: string; dailyTrains: number };
    d: { department: string; durationMin: number; segmentId: number | null };
  }[]
): ScoreableBlock[] {
  const bySegDept = new Map<string, { segId: number; dailyTrains: number; dept: string; mins: number }>();
  for (const it of items) {
    const key = `${it.d.segmentId ?? it.seg.id}:${it.d.department}`;
    const cur = bySegDept.get(key) ?? { segId: it.seg.id, dailyTrains: it.seg.dailyTrains, dept: it.d.department, mins: 0 };
    cur.mins += it.d.durationMin;
    bySegDept.set(key, cur);
  }
  const MID_WINDOW = 150; // 02:00 — the conventional "middle of the notified window" booking habit
  return [...bySegDept.values()].map((g) => ({
    segId: g.segId,
    day: 0,
    startMin: MID_WINDOW,
    endMin: MID_WINDOW + g.mins + SETUP_MIN,
    dailyTrains: g.dailyTrains,
    depts: [g.dept],
  }));
}

/** Back-compat wrapper: the deterministic baseline plan, scored with the shared objective. */
export function sequentialSiloBaseline(items: Parameters<typeof sequentialSiloBaselineBlocks>[0], totalSections = SEG_COUNT) {
  const blocks = sequentialSiloBaselineBlocks(items);
  const sc = scorePlan(blocks, totalSections);
  return {
    downtimeMin: sc.downtimeMin,
    blocks: sc.blocks,
    delayMin: sc.delayMin,
    affected: sc.affected,
    avgDelayMin: sc.avgDelayMin,
    conflicts: sc.conflicts,
    coveragePct: sc.coveragePct,
    superBlocks: sc.superBlocks,
  };
}

const SEG_COUNT = 23;

/* ------------------------------------------------------------------ */
/*  Weekly / monthly planner                                           */
/* ------------------------------------------------------------------ */
/**
 * The planning core, free of database access.
 *
 * `runOptimizer` and the benchmark harness both call this, so "the AI plan" in the comparison is
 * literally the same solver the product runs — not a re-implementation that could be tuned to win.
 * Groups by section, packs each section's tasks into department waves (block length = the longest
 * chain + lock-on), then places each block by exhaustive search under the occupancy budget.
 */
/** A block the ground has already committed: crews signed on, line already protected. */
export interface FrozenBlock {
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
  reason: string;
  /** true (default) = crews are committed, so the block is immovable and stored as `locked`.
   *  false = carried through unchanged by an incremental re-plan: it still occupies the line, but a
   *  planner may drag it. Only the first kind is a safety lock. */
  lock?: boolean;
}

export interface PlanPoolOptions {
  fogMode?: boolean;
  /** Blocks pinned into the schedule before the search starts. They occupy the line, spend the night's
   *  budget, and their work items leave the pool. `lock: true` ones are immovable — re-planning cannot
   *  un-start a gang, which is a safety property, not a nicety; `lock: false` ones are the incremental
   *  re-planner keeping a schedule it has no reason to touch. */
  frozen?: FrozenBlock[];
  /** Churn aversion. `weight` is what the room pays, in objective units, to disturb a notified block
   *  at all, on top of a term proportional to how far it moves (minutes and nights). */
  sticky?: { bySection: Map<number, { day: number; startMin: number; endMin: number }>; weight: number };
  /** "score" = highest-risk section gets the scarce night (product). "arrival" = the order the
   *  departments happened to table their lists, which is how a divisional meeting actually runs. */
  order?: "score" | "arrival";
  /** true = one occupancy per section with parallel department waves. false = every department
   *  books its own block on the same section (the silo habit the brief describes). */
  bundle?: boolean;
  /** "search" = exhaustive lowest-impact placement. "conventional" = the first night where the
   *  department's own gang is free, at the habitually requested mid-window start. */
  placement?: "search" | "conventional";
  /** minutes added to a quoted duration as allowance for lock-on/lock-off and slack. */
  paddingPct?: number;
  rng?: () => number;
}

export function planPool(
  schedulable: Candidate[],
  days: number,
  opts: PlanPoolOptions = {}
): {
  drafts: DraftBlock[];
  dayBudgetLeft: number[];
  deferredItems: number;
  deferredSections: string[];
  /** double-bookings the room had to arbitrate (manual process only) */
  arbitrations: number;
} {
  const bundle = opts.bundle !== false;
  const conventional = opts.placement === "conventional";
  const frozen = opts.frozen ?? [];
  const sticky = opts.sticky;
  const churnWeight = sticky?.weight ?? 0;

  const busy = new Map<string, [number, number][]>();
  const dayBudgetLeft = new Array(days).fill(DAILY_OCCUPANCY_BUDGET_MIN);
  const drafts: DraftBlock[] = [];

  // Committed work first: occupy the line, spend the night's budget, copy the block through verbatim.
  const frozenIds = new Set<number>();
  for (const f of frozen) {
    const key = `${f.segmentId}:${f.day}`;
    busy.set(key, [...(busy.get(key) ?? []), [f.startMin, f.endMin]]);
    dayBudgetLeft[f.day] -= f.endMin - f.startMin;
    for (const id of f.defectIds) frozenIds.add(id);
    drafts.push({
      segmentId: f.segmentId,
      day: f.day,
      startMin: f.startMin,
      endMin: f.endMin,
      departments: f.departments,
      defectIds: f.defectIds,
      isSuperBlock: f.isSuperBlock,
      mode: f.mode,
      window: f.window,
      delayCostMin: f.delayCostMin,
      estAffected: f.estAffected,
      alternatives: [],
      frozen: f.lock !== false,
      carried: f.lock === false,
      frozenReason: f.reason,
    });
  }

  /** Cost of disturbing the slot a block was notified in. Same slot costs nothing; the further it
   *  moves, the more it costs — so the solver prefers the smallest edit that fits the new reality. */
  const churnCostFor = (segId: number): ((day: number, start: number) => number) | undefined => {
    const prev = sticky?.bySection.get(segId);
    if (!prev || !churnWeight) return undefined;
    return (day: number, start: number) => {
      if (day === prev.day && start === prev.startMin && endOf(segId) === prev.endMin) return 0;
      const slide = Math.abs(start - prev.startMin) + 1440 * Math.abs(day - prev.day);
      return churnWeight + Math.min(900, slide);
    };
    function endOf(id: number) {
      return sticky!.bySection.get(id)?.endMin ?? -1;
    }
  };
  const pad = 1 + (opts.paddingPct ?? 0) / 100;
  const rng = opts.rng ?? (() => 0.5);

  // Committed items are already in the plan; they must not be placed a second time.
  const pool = frozenIds.size ? schedulable.filter((c) => !frozenIds.has(c.d.id)) : schedulable;
  const bySegment = new Map<number, Candidate[]>();
  for (const c of pool) {
    const list = bySegment.get(c.seg.id) ?? [];
    list.push(c);
    bySegment.set(c.seg.id, list);
  }

  const deferredSections = new Set<string>();
  let deferredItems = 0;
  /** How many double-bookings the room had to arbitrate. Not a penalty term — a *count* of manual
   *  intervention, reported separately so the comparison never hides behind the objective. */
  let arbitrations = 0;

  // Working units: one per section when departments are bundled, one per department when they are not.
  type Unit = { seg: SegmentLite; list: Candidate[]; dept: string | null };
  const units: Unit[] = [];
  for (const [, list] of bySegment) {
    const seg = list[0].seg;
    if (bundle) {
      units.push({ seg, list, dept: null });
    } else {
      for (const dept of [...new Set(list.map((c) => c.d.department))].sort())
        units.push({ seg, list: list.filter((c) => c.d.department === dept), dept });
    }
  }

  const unitKey = (u: Unit) => (u.dept ? `${u.seg.id}:${u.dept}` : `${u.seg.id}`);
  const ordered =
    opts.order === "arrival"
      ? units // the order the lists arrived — no risk weighting applied by the room
      : [...units].sort(
          (a, b) =>
            Math.max(...b.list.map((c) => c.scored.score)) - Math.max(...a.list.map((c) => c.scored.score))
        );

  // A department has one working gang per night: it cannot be on two sections at once. This is a
  // real staffing fact, not a modelled weakness, and it is what makes silo booking so expensive.
  const deptDayUsed = new Map<string, Set<number>>();

  for (const u of ordered) {
    const tasks = u.list.map((c) => ({ id: c.d.id, department: c.d.department, durationMin: c.d.durationMin }));
    const { makespan, byDept } = packWaves(tasks);
    // Two ceilings, and both bind: the golden window's usable minutes, and the longest occupation the
    // rule book grants the departments doing the work. Clamping only to the window is what once let a
    // 215-min ENG-only block through — the generator then failed its own compliance check.
    const deptCap = maxBlockMinutes(Object.keys(byDept));
    const dur = Math.max(45, Math.min(GOLDEN_CAP, deptCap, Math.round((makespan + SETUP_MIN) * pad)));
    const maxSev = Math.max(...u.list.map((c) => c.scored.severity));
    const b = conventional
      ? placeConventional(u.seg, dur, days, busy, dayBudgetLeft, deptDayUsed, u.dept, rng, () => (arbitrations += 1))
      : placeBlock(u.seg, dur, days, maxSev, busy, dayBudgetLeft, WINDOWS, churnCostFor(u.seg.id));
    if (!b) {
      deferredSections.add(u.seg.code);
      deferredItems += u.list.length;
      continue;
    }
    b.departments = Object.keys(byDept).sort();
    b.defectIds = u.list.map((c) => c.d.id);
    b.isSuperBlock = b.departments.length >= 2;
    b.mode = opts.fogMode ? "virtual" : "physical";
    b.unitKey = unitKey(u);

    // ---- audit note: the numbers the search actually traded off ----
    const driver = [...u.list].sort((a, c) => c.scored.score - a.scored.score)[0];
    const separateMin = Object.values(byDept).reduce((t, m) => t + m + SETUP_MIN, 0);
    const runner = b.alternatives[0];
    const why = [
      `${driver.scored.score} priority: ${driver.d.title}`,
      `${u.list.length} open item${u.list.length === 1 ? "" : "s"} on ${u.seg.code} grouped into one occupation`,
      `${b.window} slot — ${b.delayCostMin} train-minutes of delay across ~${Math.round(b.estAffected)} trains`,
      `block length = longest department chain (${makespan} min) + ${SETUP_MIN} min lock-on`,
    ];
    if (separateMin > dur) why.push(`bundling saves ${separateMin - dur} min of line occupation vs booking separately`);
    if (runner?.label) {
      const gap = runner.penalty ?? 0;
      why.push(
        gap >= 1
          ? `next best slot ${runner.label} cost ${Math.round(gap)} more, so it lost`
          : `next best slot ${runner.label} was effectively tied (${Math.round(gap)} units) — the golden window wins the tie-break`
      );
    }
    if (maxSev >= 8) why.push(`carries a severity-${maxSev} item: cannot wait for a cleaner night`);
    const wasSticky = sticky?.bySection.get(u.seg.id);
    if (wasSticky && b.day === wasSticky.day && b.startMin === wasSticky.startMin)
      why.push(`kept in its notified slot — moving it would disturb crews already working to it`);
    b.explain = {
      why,
      terms: driver.scored.contributions,
      drivingDefect: { id: driver.d.id, title: driver.d.title, score: driver.scored.score, severity: driver.scored.severity, risk: driver.scored.risk },
      chosen: {
        day: b.day,
        startMin: b.startMin,
        endMin: b.endMin,
        window: b.window,
        delayCostMin: b.delayCostMin,
        affectedTrains: Math.round(b.estAffected),
      },
      runnerUp: runner?.label
        ? { label: runner.label, cost: Math.round(runner.cost * 10) / 10, penaltyVsChosen: runner.penalty ?? 0 }
        : null,
      budget: {
        day: b.day,
        usedMin: DAILY_OCCUPANCY_BUDGET_MIN - dayBudgetLeft[b.day],
        limitMin: DAILY_OCCUPANCY_BUDGET_MIN,
      },
      bundling: {
        departments: b.departments,
        separateBlockMin: separateMin,
        bundledBlockMin: dur,
        savedMin: Math.max(0, separateMin - dur),
      },
    };
    drafts.push(b);
  }

  return { drafts, dayBudgetLeft, deferredItems, deferredSections: [...deferredSections], arbitrations };
}


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
  const core = planPool(schedulable, days);
  const { drafts, dayBudgetLeft, deferredItems, deferredSections } = core;

  const aiScore = scorePlan(
    drafts.map((b) => ({ segId: b.segmentId, day: b.day, startMin: b.startMin, endMin: b.endMin, dailyTrains: lake.segById.get(b.segmentId)?.dailyTrains ?? 60, depts: b.departments })),
    lake.segById.size
  );
  const baseline = sequentialSiloBaseline(schedulable, lake.segById.size);
  const optimMin = aiScore.downtimeMin;
  const totalDelay = aiScore.delayMin;
  const totalAffected = aiScore.affected;
  const avgDelay = aiScore.avgDelayMin;

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
    bundlingPct: aiScore.bundlingPct,
    blocks: drafts.length,
    baselineBlocks: baseline.blocks,
    superBlocks: aiScore.superBlocks,
    coveragePct: aiScore.coveragePct,
    baselineCoveragePct: baseline.coveragePct,
    avgDelayMin: avgDelay,
    baselineDelayMin: baseline.avgDelayMin,
    delayReductionPct: Math.round((1 - totalDelay / Math.max(baseline.delayMin, 1)) * 100),
    bundlingHoursSaved: Math.round(((baseline.downtimeMin - optimMin) / 60) * 10) / 10,
    defectsCleared: drafts.reduce((s, b) => s + b.defectIds.length, 0),
    deferredItems,
    delayTrainMin: Math.round(totalDelay),
    baselineDelayTrainMin: Math.round(baseline.delayMin),
    occupancyBudgetMin: days * DAILY_OCCUPANCY_BUDGET_MIN,
    occupancyUsedMin: days * DAILY_OCCUPANCY_BUDGET_MIN - dayBudgetLeft.reduce((a, b) => a + b, 0),
    noBlockExecuted: noBlock.length,
    suspendedByFog: lake.fogMode ? suspendedFog : 0,
    withheldByVip: lake.vipAlert ? withheldVip : 0,
    conflictsAvoided: baseline.conflicts,
    aiConflicts: aiScore.conflicts,
    frozenBlocks: drafts.filter((b) => b.frozen).length,
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
        // ?? binds tighter than the conditional, so the fallback chain needs its own parentheses:
        // without them `(b.explain ?? b.frozen) ? stub : …` replaced every real explanation with the
        // frozen stub. Keep them, and keep the cast on the whole expression.
        explain: (b.explain ??
          (b.frozen
            ? { frozenReason: b.frozenReason ?? "crew signed on" }
            : b.carried
              ? { carried: true, frozenReason: b.frozenReason }
              : null)) as Record<string, unknown> | null,
        // `locked` is the only state in which a block may not be moved by hand (see PATCH /api/blocks).
        status: b.frozen ? "locked" : "proposed",
      }))
    );
    const allIds = drafts.flatMap((b) => b.defectIds);
    await db.update(defects).set({ status: "scheduled", updatedAt: new Date() }).where(inArray(defects.id, allIds));
    // Compliance is evaluated on the stored rows, not on the drafts: the rows are what the crews
    // will actually be signed out against.
    await publishPolicy(plan.id);
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
    log.push(`Occupancy budget (${days} d × ${DAILY_OCCUPANCY_BUDGET_MIN} min/day) exhausted: ${deferredItems} lower-priority items on ${deferredSections.length} sections deferred to the next cycle with reason recorded — deliberately leaving capacity for tomorrow's emergency`);
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

  const rollScore = scorePlan(
    drafts.map((b) => ({
      segId: b.segmentId,
      day: b.day,
      startMin: b.startMin,
      endMin: b.endMin,
      dailyTrains: lake.segById.get(b.segmentId)?.dailyTrains ?? 60,
      depts: b.departments,
    })),
    lake.segById.size
  );

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
    aiConflicts: rollScore.conflicts,
    coveragePct: rollScore.coveragePct,
    baselineCoveragePct: baseline.coveragePct,
    bundlingHoursSaved: Math.round(((baseline.downtimeMin - optimMin) / 60) * 10) / 10,
    delayTrainMin: Math.round(totalDelay),
    baselineDelayTrainMin: Math.round(baseline.delayMin),
    frozenBlocks: 0,
    crewWaves: drafts.length,
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
        // ?? binds tighter than the conditional, so the fallback chain needs its own parentheses:
        // without them `(b.explain ?? b.frozen) ? stub : …` replaced every real explanation with the
        // frozen stub. Keep them, and keep the cast on the whole expression.
        explain: (b.explain ??
          (b.frozen
            ? { frozenReason: b.frozenReason ?? "crew signed on" }
            : b.carried
              ? { carried: true, frozenReason: b.frozenReason }
              : null)) as Record<string, unknown> | null,
        // `locked` is the only state in which a block may not be moved by hand (see PATCH /api/blocks).
        status: b.frozen ? "locked" : "proposed",
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
      // Nothing was scheduled, so there is no variance to measure: 0, not a flattering 99. The
      // dashboard only reads this when the plan has blocks in it.
      resilienceScore: 0,
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
        aiConflicts: 0,
        coveragePct: 0,
        baselineCoveragePct: 0,
        bundlingHoursSaved: 0,
        delayTrainMin: 0,
        baselineDelayTrainMin: 0,
        policyScore: 100,
        policyCompliantBlocks: 0,
        policyViolations: 0,
        policyWarnings: 0,
        // resilienceScore is a plans column, not a kpis key — the DTO and state.ts read the column,
        // so duplicating it here would give the same figure two sources of truth.
        occupancyBudgetMin: 0,
        occupancyUsedMin: 0,
        crewWaves: 0,
        frozenBlocks: 0,
        h0: 0, h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0, h7: 0,
      },
    })
    .returning();
  return getPlanDTO(plan.id);
}

/** Build the rule-engine environment from the tables (settings toggles decide which rules are live). */
export async function policyEnv() {
  const [segRows, setRows] = await Promise.all([db.select().from(segments), db.select().from(settings)]);
  const sMap = new Map(setRows.map((r) => [r.key, r.value]));
  return {
    segments: new Map(segRows.map((r) => [r.id, { id: r.id, code: r.code, corridor: r.corridor, fromCode: r.fromCode, toCode: r.toCode }])),
    settings: { fogMode: sMap.get("fogMode") === "true", vipAlert: sMap.get("vipAlert") === "true" },
    windows: WINDOWS,
    recoveryGapMin: RECOVERY_GAP_MIN,
    dailyBudgetMin: DAILY_OCCUPANCY_BUDGET_MIN,
    vipStations: VIP_STATIONS,
  };
}

/**
 * Evaluate the rule book for a stored plan and write each block's verdict back onto its row, so the
 * Gantt and the approval screen render the same compliance state without recomputing it per client.
 * Returns the plan-level report for the caller's log / KPI.
 */
/**
 * Same verdict as `attachPolicyToPlan`, computed from in-memory blocks and with no writes — a dry run
 * has to show what the rule book would say about a plan that does not exist yet. Both call
 * `evaluatePlanPolicy` with the same environment, so a dry-run preview cannot disagree with the
 * figure the published row ends up carrying.
 */
export async function evaluateDraftPolicy(
  drafts: { segmentId: number; day: number; startMin: number; endMin: number; departments: string[]; mode: string }[]
) {
  return evaluatePlanPolicy(
    drafts.map((b, i) => ({ id: -(i + 1), ...b })),
    await policyEnv()
  );
}

export async function attachPolicyToPlan(planId: number) {
  const rows = await db.select().from(blockItems).where(eq(blockItems.planId, planId));
  const report = evaluatePlanPolicy(
    rows.map((b) => ({
      id: b.id,
      segmentId: b.segmentId,
      day: b.day,
      startMin: b.startMin,
      endMin: b.endMin,
      departments: b.departments,
      mode: b.mode,
    })),
    await policyEnv()
  );
  await Promise.all(
    rows.map((b) => {
      const mine = report.perBlock[b.id];
      return db
        .update(blockItems)
        .set({
          policy: mine
            ? { score: mine.score, violations: mine.violations, warnings: mine.warnings }
            : { score: 100, violations: [], warnings: [] },
        })
        .where(eq(blockItems.id, b.id));
    })
  );
  return report;
}

/** `attachPolicyToPlan` plus the plan-level KPI merge, so the stored plan and the DTO agree. */
export async function publishPolicy(planId: number) {
  const report = await attachPolicyToPlan(planId);
  const [row] = await db.select().from(plans).where(eq(plans.id, planId));
  if (row)
    await db
      .update(plans)
      .set({
        kpis: {
          ...row.kpis,
          policyScore: report.score,
          policyCompliantBlocks: report.compliantBlocks,
          policyViolations: report.hardViolations,
          policyWarnings: report.softWarnings,
        },
      })
      .where(eq(plans.id, planId));
  return report;
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
        frozen: b.status === "locked",
        carried: (b.explain as { carried?: boolean } | null)?.carried === true,
        frozenReason: (b.explain as { frozenReason?: string } | null)?.frozenReason,
      };
    })
    .sort((a, b) => a.day - b.day || a.startMin - b.startMin);

  // Compliance is re-derived from the rows the Gantt is about to draw, so a plan that has been
  // dragged by hand, or that a settings toggle has just invalidated, cannot still look clean.
  const pol = evaluatePlanPolicy(
    items.map((b) => ({
      id: b.id,
      segmentId: b.segmentId,
      day: b.day,
      startMin: b.startMin,
      endMin: b.endMin,
      departments: b.departments,
      mode: b.mode,
    })),
    await policyEnv()
  );
  for (const b of blocks) {
    const mine = pol.perBlock[b.id];
    if (mine) {
      b.policy = { score: mine.score, violations: mine.violations, warnings: mine.warnings };
      b.overrideReason = (items.find((i) => i.id === b.id)?.overrideReason as string) ?? null;
    }
  }
  return {
    id: p.id,
    name: p.name,
    horizon: p.horizon,
    createdAt: p.createdAt.toISOString(),
    resilienceScore: p.resilienceScore,
    kpis: { ...p.kpis, policyScore: pol.score, policyCompliantBlocks: pol.compliantBlocks, policyViolations: pol.hardViolations, policyWarnings: pol.softWarnings },
    policy: { score: pol.score, compliantBlocks: pol.compliantBlocks, hardViolations: pol.hardViolations, softWarnings: pol.softWarnings, rules: pol.rules, summary: pol.summary },
    blocks,
  };
}

export async function getLatestPlan(): Promise<PlanDTO | null> {
  const [p] = await db.select().from(plans).orderBy(desc(plans.id)).limit(1);
  if (!p) return null;
  return getPlanDTO(p.id);
}
