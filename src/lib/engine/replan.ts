/**
 * Incremental re-plan with a plan diff.
 * ---------------------------------------------------------------------------
 * Ops reality, from the brief: at 02:10 a patroller reports a rail crack on a section that already
 * has six blocks notified for the week. A division cannot re-issue tomorrow's whole schedule because
 * of one call — the gangs have been told, the COA has the diagram, the departments have their
 * working advice. So re-planning must be a *minimal edit* over the plan already in force, and the
 * edit itself has to be visible: what was added, what moved, what was dropped, what stayed put.
 *
 * Three properties this file is built around:
 *
 *  1. **Nothing already under way is touched.** A block whose job is IN_PROGRESS or awaiting review
 *     means crews are signed on and the line is protected. Such blocks are pinned into the new plan
 *     verbatim, marked `locked`, and refused by the drag endpoint. Re-planning cannot un-start a gang.
 *  2. **Sections the event does not concern keep their slot.** The search only runs over affected
 *     sections; everything else is carried through unchanged (pinned, but still editable by a human).
 *     Unaffected work is not "re-optimised" into a different night for no reason.
 *  3. **Churn has a price inside the objective.** For the sections that must be re-solved, the search
 *     charges `churnWeight` plus a term proportional to how far a block moves, so when several slots
 *     are nearly equal on delay, the one that disturbs the fewest crews wins. `mode:"full"` drops that
 *     term — the comparison between the two is the honest way to state what stability costs.
 *
 * Nothing is invented when there is nothing to do: if the live pool matches the published plan, the
 * call reports `replanned: false` and no new plan row is created, so repeating it is free.
 */

import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { blockItems, defects, events, jobs, plans } from "@/db/schema";
import {
  classify,
  getLatestPlan,
  loadLake,
  planPool,
  publishPolicy,
  scorePlan,
  sequentialSiloBaseline,
  evaluateDraftPolicy,
  DAILY_OCCUPANCY_BUDGET_MIN,
  type FrozenBlock,
} from "./optimizer";
import { fmtMin } from "./network";

export type DiffKind = "unchanged" | "moved" | "added" | "dropped" | "held";

export interface DiffEntry {
  segmentId: number;
  code: string;
  kind: DiffKind;
  from?: { day: number; startMin: number; endMin: number };
  to?: { day: number; startMin: number; endMin: number };
  /** minutes the start moved (signed: negative = earlier). */
  shiftMin: number;
  /** nights the block moved by — the part a crew actually feels. */
  nights: number;
  /** how much longer/shorter the occupation became (the work set changed even when the start did not). */
  lengthDeltaMin: number;
  defectIds: number[];
  departments: string[];
  locked: boolean;
  note: string;
}

export interface ReplanDiff {
  previousPlanId: number | null;
  newPlanId: number | null;
  /** blocks of the previous plan that keep exactly the same slot. */
  stabilityPct: number;
  unchanged: number;
  moved: number;
  added: number;
  dropped: number;
  held: number;
  /** total start-time movement across the plan, in minutes — churn as a physical quantity. */
  shiftMinutes: number;
  nightsChanged: number;
  blocks: DiffEntry[];
  trigger: string;
  mode: "incremental" | "full";
  affectedSections: string[];
  /** set when the minimal edit could not absorb the change and a wider re-optimisation is advised. */
  escalation: string | null;
}

export interface ReplanResult {
  replanned: boolean;
  /** true when the result was computed and then thrown away (comparison mode, no writes). */
  dryRun: boolean;
  diff: ReplanDiff;
  /** the figures behind the diff — the cost side of "stability". */
  metrics: {
    planId: number | null;
    blocks: number;
    defectsCleared: number;
    deferredItems: number;
    delayTrainMin: number;
    occupancyUsedMin: number;
    coveragePct: number;
    policyScore: number;
    hardViolations: number;
  };
  log: string[];
  notified: { department: string; blocks: string[] }[];
}

const LOCKED_JOBS = ["IN_PROGRESS", "AWAITING_REVIEW"];
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const when = (b: { day: number; startMin: number; endMin: number }) =>
  `${DAY_NAMES[b.day % 7] ?? `D+${b.day}`} ${fmtMin(b.startMin)}–${fmtMin(b.endMin)}`;

const slot = (b: { day: number; startMin: number; endMin: number }) => ({ day: b.day, startMin: b.startMin, endMin: b.endMin });
const sameSlot = (a?: { day: number; startMin: number; endMin: number }, b?: { day: number; startMin: number; endMin: number }) =>
  !!a && !!b && a.day === b.day && Math.abs(a.startMin - b.startMin) < 1 && Math.abs(a.endMin - b.endMin) < 1;

/**
 * Reconcile the published plan with the live backlog, changing as little as possible.
 *
 * `mode: "full"` is the comparison case: the same locked blocks and the same pool, but no churn term
 * and no carried slots — i.e. what a fresh "Run Optimizer" click does. The gap between the two runs is
 * the cost of stability, measured rather than asserted.
 */
export async function replan(
  opts: { mode?: "incremental" | "full"; notify?: boolean; triggerNote?: string; churnWeight?: number; dryRun?: boolean } = {}
): Promise<ReplanResult> {
  const mode = opts.mode === "full" ? "full" : "incremental";
  const dry = opts.dryRun === true;
  const churnWeight = mode === "full" ? 0 : Math.max(0, Math.round(opts.churnWeight ?? 150));
  const log: string[] = [];
  if (dry) log.push("dry run — nothing will be written until the re-plan is published");

  const prev = await getLatestPlan();
  if (!prev) throw new Error("no published plan to re-plan — run the optimizer first");
  const days = prev.horizon === "MONTHLY" ? 28 : 7;

  const lake = await loadLake();
  const { schedulable } = classify(lake);
  const prevRows = await db.select().from(blockItems).where(eq(blockItems.planId, prev.id));

  // --- which of the previous blocks is beyond recall? ---
  const prevDefectIds = prevRows.flatMap((r) => r.defectIds);
  const busyJobs = prevDefectIds.length
    ? await db
        .select()
        .from(jobs)
        .where(and(inArray(jobs.defectId, prevDefectIds), inArray(jobs.status, LOCKED_JOBS)))
    : [];
  const underExecution = new Set(busyJobs.map((j) => j.defectId).filter((x): x is number => x != null));
  const lockedRows = prevRows.filter((r) => r.defectIds.some((id) => underExecution.has(id)));
  const lockedIds = new Set(lockedRows.flatMap((r) => r.defectIds));
  log.push(
    lockedRows.length > 0
      ? `${lockedRows.length} block(s) frozen — crews signed on (${lockedRows.map((r) => `#${r.id}`).join(", ")}): not movable by a re-plan`
      : "no block under execution — nothing frozen"
  );

  // --- what actually changed? a section is affected when its live work set differs from the one the
  //     plan was built on, or when it has work and no block yet. ---
  const poolBySeg = new Map<number, number[]>();
  for (const c of schedulable) {
    if (lockedIds.has(c.d.id)) continue;
    poolBySeg.set(c.seg.id, [...(poolBySeg.get(c.seg.id) ?? []), c.d.id]);
  }
  const prevBySeg = new Map<number, number[]>();
  for (const r of prevRows) prevBySeg.set(r.segmentId, r.defectIds.filter((id) => !lockedIds.has(id)));

  const affected = new Set<number>();
  for (const [segId, ids] of poolBySeg) {
    const was = prevBySeg.get(segId) ?? [];
    if (new Set([...ids].sort()).size !== new Set([...was].sort()).size || !ids.every((i) => was.includes(i))) affected.add(segId);
  }
  for (const [segId, was] of prevBySeg) {
    if (!poolBySeg.has(segId) && was.length > 0) affected.add(segId); // work vanished (cleared by hand) → the block must shrink or go
  }
  if (lockedIds.size) for (const r of lockedRows) affected.delete(r.segmentId); // frozen sections are settled

  const affectedCodes = [...affected].map((id) => lake.segById.get(id)?.code ?? `#${id}`);
  if (mode === "incremental" && affected.size === 0) {
    return {
      replanned: false,
      dryRun: dry,
      diff: {
        previousPlanId: prev.id,
        newPlanId: prev.id,
        stabilityPct: 100,
        unchanged: prevRows.length,
        moved: 0,
        added: 0,
        dropped: 0,
        held: 0,
        shiftMinutes: 0,
        nightsChanged: 0,
        blocks: [],
        trigger: opts.triggerNote ?? "no change",
        mode,
        affectedSections: [],
        escalation: null,
      },
      metrics: {
        planId: prev.id,
        blocks: prevRows.length,
        defectsCleared: prevDefectIds.length,
        deferredItems: 0,
        delayTrainMin: (prev.kpis?.delayTrainMin as number) ?? 0,
        occupancyUsedMin: (prev.kpis?.occupancyUsedMin as number) ?? 0,
        coveragePct: (prev.kpis?.coveragePct as number) ?? 0,
        policyScore: (prev.kpis?.policyScore as number) ?? 100,
        hardViolations: (prev.kpis?.policyViolations as number) ?? 0,
      },
      log: dry
        ? [`Live backlog matches plan #${prev.id} exactly — a re-plan would change nothing`]
        : [`Live backlog matches plan #${prev.id} exactly — no re-plan issued (nothing to change)`],
      notified: [],
    };
  }

  const scope = mode === "full" ? new Set<number>([...poolBySeg.keys(), ...prevBySeg.keys()]) : affected;
  log.push(
    mode === "full"
      ? `full re-optimisation: all ${scope.size} sections with live work re-solved, churn term off`
      : `incremental: ${scope.size} section(s) affected (${affectedCodes.join(", ") || "none"}), ${prevRows.length - lockedRows.length - scope.size} carried through untouched`
  );

  // --- pinned blocks: locked rows always; in incremental mode also the unaffected sections ---
  const preplaced: FrozenBlock[] = [];
  for (const r of prevRows) {
    const isLocked = lockedIds.size > 0 && r.defectIds.some((id) => underExecution.has(id));
    if (!isLocked && (mode === "full" || scope.has(r.segmentId))) continue;
    preplaced.push({
      segmentId: r.segmentId,
      day: r.day,
      startMin: r.startMin,
      endMin: r.endMin,
      departments: r.departments,
      defectIds: r.defectIds,
      isSuperBlock: r.isSuperBlock,
      mode: r.mode,
      window: r.window,
      delayCostMin: r.delayCostMin,
      estAffected: Math.max(1, Math.round(r.defectIds.length)),
      lock: isLocked,
      reason: isLocked ? "crew signed on — job in execution" : "carried from the plan in force",
    });
  }
  const pinnedDefectIds = new Set(preplaced.flatMap((p) => p.defectIds));
  const heldCount = preplaced.filter((p) => !p.lock).length;

  const pool = schedulable.filter((c) => scope.has(c.seg.id) && !pinnedDefectIds.has(c.d.id));
  if (pool.length === 0 && preplaced.length > 0) {
    // Nothing left to solve, only work to carry: still a real change (a block disappears or shrinks).
    log.push(`no new work to place — publishing the plan with ${preplaced.length} block(s) carried`);
  }

  const sticky = { bySection: new Map<number, { day: number; startMin: number; endMin: number }>() };
  for (const r of prevRows) sticky.bySection.set(r.segmentId, { day: r.day, startMin: r.startMin, endMin: r.endMin });

  const core = planPool(pool, days, {
    fogMode: lake.fogMode,
    frozen: preplaced,
    sticky: churnWeight ? { ...sticky, weight: churnWeight } : undefined,
  });
  const drafts = core.drafts;
  log.push(`placement search: ${pool.length} live item(s) over ${scope.size} section(s) → ${drafts.length} block(s), churn weight ${churnWeight}`);
  if (core.deferredItems > 0) {
    core.deferredSections.forEach((code) => log.push(`deferred on ${code}: no compliant slot left that does not disturb a notified block`));
    log.push(`→ the minimal edit could not absorb the change: recommend a full re-optimisation`);
  }

  // --- metrics (identical whether or not anything is written) ---
  const score = scorePlan(
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
  const baseline = sequentialSiloBaseline(schedulable, lake.segById.size);
  const optimMin = score.downtimeMin;
  const totalDelay = score.delayMin;
  const cleared = drafts.reduce((a, b) => a + b.defectIds.length, 0);
  const occupancyUsed = days * DAILY_OCCUPANCY_BUDGET_MIN - core.dayBudgetLeft.reduce((a, b) => a + b, 0);

  // --- the diff, from the drafts themselves rather than a re-read of the table: the preview and the
  //     published plan are then computed by the same lines, so a dry run cannot promise one thing and
  //     write another. ---
  type Shape = { day: number; startMin: number; endMin: number; defectIds: number[]; departments: string[]; status: string };
  const newBySeg: Map<number, Shape> = new Map(
    drafts.map((b) => [
      b.segmentId,
      { day: b.day, startMin: b.startMin, endMin: b.endMin, defectIds: b.defectIds, departments: b.departments, status: b.frozen ? "locked" : "proposed" },
    ])
  );
  const oldBySeg: Map<number, Shape> = new Map(
    prevRows.map((r) => [
      r.segmentId,
      { day: r.day, startMin: r.startMin, endMin: r.endMin, defectIds: r.defectIds, departments: r.departments, status: r.status },
    ])
  );
  const blocks: DiffEntry[] = [];
  let unchanged = 0;
  let moved = 0;
  let added = 0;
  let dropped = 0;
  let shiftMinutes = 0;
  let nightsChanged = 0;
  for (const segId of new Set([...oldBySeg.keys(), ...newBySeg.keys()])) {
    const o = oldBySeg.get(segId);
    const n = newBySeg.get(segId);
    const code = lake.segById.get(segId)?.code ?? `#${segId}`;
    if (o && n && sameSlot(slot(o), slot(n))) {
      unchanged += 1;
      blocks.push({
        segmentId: segId,
        code,
        kind: "unchanged",
        from: slot(o),
        to: slot(n),
        shiftMin: 0,
        nights: 0,
        lengthDeltaMin: 0,
        defectIds: n.defectIds,
        departments: n.departments,
        locked: n.status === "locked",
        note:
          n.status === "locked"
            ? "held: crew signed on"
            : n.defectIds.length !== o.defectIds.length
              ? `notified slot kept, work set changed to ${n.defectIds.length} item(s)`
              : "notified slot kept",
      });
      continue;
    }
    if (o && n) {
      moved += 1;
      const shift = n.startMin - o.startMin;
      const nights = n.day - o.day;
      const lengthDelta = n.endMin - n.startMin - (o.endMin - o.startMin);
      shiftMinutes += Math.abs(shift);
      if (nights !== 0) nightsChanged += 1;
      blocks.push({
        segmentId: segId,
        code,
        kind: "moved",
        from: slot(o),
        to: slot(n),
        shiftMin: shift,
        nights,
        lengthDeltaMin: lengthDelta,
        defectIds: n.defectIds,
        departments: n.departments,
        locked: n.status === "locked",
        // A block can move without changing its start — extra work absorbed into the same occupation is
        // the common case, and calling that "+0 min" would hide what actually happened.
        note: [
          shift !== 0 ? `${shift >= 0 ? "+" : ""}${shift} min start` : "same start",
          nights !== 0 ? `${nights >= 0 ? "+" : ""}${nights} night(s)` : "same night",
          lengthDelta !== 0 ? `${lengthDelta >= 0 ? "+" : ""}${lengthDelta} min occupation` : "same length",
        ].join(", "),
      });
      continue;
    }
    if (n && !o) {
      added += 1;
      blocks.push({
        segmentId: segId,
        code,
        kind: "added",
        to: slot(n),
        shiftMin: 0,
        nights: 0,
        lengthDeltaMin: n.endMin - n.startMin,
        defectIds: n.defectIds,
        departments: n.departments,
        locked: n.status === "locked",
        note: "new occupation for work that arrived after the plan was cut",
      });
      continue;
    }
    if (o && !n) {
      dropped += 1;
      blocks.push({
        segmentId: segId,
        code,
        kind: "dropped",
        from: slot(o),
        shiftMin: 0,
        nights: 0,
        lengthDeltaMin: -(o.endMin - o.startMin),
        defectIds: o.defectIds,
        departments: o.departments,
        locked: false,
        note: "released — its work was cleared or moved into another block",
      });
    }
  }
  const stabilityPct = prevRows.length ? Math.round((unchanged / prevRows.length) * 100) : 100;

  const diff: ReplanDiff = {
    previousPlanId: prev.id,
    newPlanId: null,
    stabilityPct,
    unchanged,
    moved,
    added,
    dropped,
    held: heldCount,
    shiftMinutes,
    nightsChanged,
    blocks: blocks.sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.code.localeCompare(b.code)),
    trigger: opts.triggerNote ?? (mode === "full" ? "manual full re-optimisation" : "backlog changed"),
    mode,
    affectedSections: affectedCodes,
    escalation:
      core.deferredItems > 0
        ? `${core.deferredItems} item(s) could not be placed without disturbing a notified block — run a full re-optimisation or extend the horizon`
        : null,
  };

  let planId: number | null = null;
  let policyScore = 100;
  let hardViolations = 0;
  if (dry) {
    const pol = await evaluateDraftPolicy(
      drafts.map((b) => ({ segmentId: b.segmentId, day: b.day, startMin: b.startMin, endMin: b.endMin, departments: b.departments, mode: b.mode }))
    );
    policyScore = pol.score;
    hardViolations = pol.hardViolations;
    log.push(`draft rule book (not stored): ${pol.summary}`);
    log.push(`dry run: ${unchanged}/${prevRows.length} blocks unchanged, ${added} added, ${moved} moved, ${dropped} released — publish to make it the plan in force`);
  } else {
    const [planRow] = await db
      .insert(plans)
      .values({
        name: `${mode === "full" ? "Full re-optimisation" : "Incremental re-plan"} — Delhi NCR (supersedes #${prev.id})`,
        horizon: prev.horizon,
        supersedesId: prev.id,
        triggerNote: diff.trigger,
        resilienceScore: prev.resilienceScore,
        diff: diff as unknown as Record<string, unknown>,
        kpis: {
          ...planKpis(drafts, core, score, baseline, days, totalDelay, optimMin, cleared, occupancyUsed, prevRows.length, unchanged),
        },
      })
      .returning();
    planId = planRow.id;
    diff.newPlanId = planRow.id;

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
          status: b.frozen ? "locked" : "proposed",
          explain: (b.explain ??
            (b.frozen
              ? { frozenReason: b.frozenReason ?? "crew signed on" }
              : b.carried
                ? { carried: true, frozenReason: b.frozenReason }
                : { replanOf: prev.id })) as Record<string, unknown> | null,
        }))
      );
    }

    // Allocation, not consumption: what the new plan covers becomes `scheduled`, anything that was
    // scheduled under the old plan and is now left out returns to the open pool for the next cycle.
    const allIds = drafts.flatMap((b) => b.defectIds);
    if (allIds.length) await db.update(defects).set({ status: "scheduled", updatedAt: new Date() }).where(inArray(defects.id, allIds));
    await db
      .update(defects)
      .set({ status: "open", updatedAt: new Date() })
      .where(allIds.length ? and(eq(defects.status, "scheduled"), notInArray(defects.id, allIds)) : eq(defects.status, "scheduled"));
    await db.update(plans).set({ diff: diff as unknown as Record<string, unknown> }).where(eq(plans.id, planRow.id));

    // The rule book has to like a re-plan as much as it likes a fresh plan: nothing publishes that way.
    const pol = await publishPolicy(planRow.id);
    policyScore = pol.score;
    hardViolations = pol.hardViolations;
    log.push(`rule book over the re-plan: ${pol.summary}`);
    await db.insert(events).values([
      {
        kind: "ai",
        message: `${mode === "full" ? "Full re-optimisation" : "Incremental re-plan"} published — ${unchanged}/${prevRows.length} blocks unchanged (${stabilityPct}% stability), ${added} added, ${moved} moved, ${dropped} released; ${lockedRows.length} held for crews already on the line`,
      },
      ...(pol.hardViolations > 0
        ? [{ kind: "critical" as const, message: `Re-plan carries ${pol.hardViolations} rule-book breach(es) — approval is gated until they are resolved` }]
        : []),
    ]);
    log.push(`plan #${prev.id} → #${planRow.id}: ${unchanged} unchanged · ${added} added · ${moved} moved · ${dropped} released · ${heldCount} carried`);
  }

  // --- working advice, only for the departments actually affected ---
  const notified: { department: string; blocks: string[] }[] = [];
  if (opts.notify && !dry) {
    const byDept = new Map<string, string[]>();
    for (const b of diff.blocks) {
      if (b.kind === "unchanged") continue;
      for (const d of new Set(b.departments)) {
        const line =
          b.kind === "moved"
            ? `${b.code} moved ${when(b.from!)} → ${when(b.to!)}`
            : b.kind === "added"
              ? `new block on ${b.code} at ${when(b.to!)}`
              : `${b.code} ${when(b.from!)} released — do not sign on`;
        byDept.set(d, [...(byDept.get(d) ?? []), line]);
      }
    }
    for (const [dept, lines] of [...byDept.entries()].sort()) {
      notified.push({ department: dept, blocks: lines });
      await db.insert(events).values({
        kind: "warn",
        message: `Working advice sent to ${dept}: ${lines.length} block(s) changed — ${lines.join(" · ")}`,
      });
    }
    log.push(notified.length ? `working advice sent to ${notified.map((n) => `${n.department} (${n.blocks.length})`).join(", ")}` : "no department needed a new working advice");
  } else if (opts.notify && dry) {
    log.push("dry run: working advice not sent");
  }

  return {
    replanned: !dry,
    dryRun: dry,
    diff,
    metrics: {
      planId,
      blocks: drafts.length,
      defectsCleared: cleared,
      deferredItems: core.deferredItems,
      delayTrainMin: Math.round(totalDelay),
      occupancyUsedMin: occupancyUsed,
      coveragePct: score.coveragePct,
      policyScore,
      hardViolations,
    },
    log,
    notified,
  };
}

/** The KPI row a re-plan publishes — one object, so the stored shape cannot drift from the planner's. */
function planKpis(
  drafts: { frozen?: boolean }[],
  core: { deferredItems: number; dayBudgetLeft: number[] },
  score: ReturnType<typeof scorePlan>,
  baseline: ReturnType<typeof sequentialSiloBaseline>,
  days: number,
  totalDelay: number,
  optimMin: number,
  cleared: number,
  occupancyUsed: number,
  prevBlockCount: number,
  unchangedCount: number
) {
  return {
    downtimeBaselineH: Math.round((baseline.downtimeMin / 60) * 10) / 10,
    downtimeOptimizedH: Math.round((optimMin / 60) * 10) / 10,
    reductionPct: Math.round((1 - optimMin / Math.max(baseline.downtimeMin, 1)) * 100),
    bundlingPct: score.bundlingPct,
    blocks: drafts.length,
    baselineBlocks: baseline.blocks,
    superBlocks: score.superBlocks,
    coveragePct: score.coveragePct,
    baselineCoveragePct: baseline.coveragePct,
    avgDelayMin: score.avgDelayMin,
    baselineDelayMin: baseline.avgDelayMin,
    delayReductionPct: Math.round((1 - totalDelay / Math.max(baseline.delayMin, 1)) * 100),
    bundlingHoursSaved: Math.round(((baseline.downtimeMin - optimMin) / 60) * 10) / 10,
    defectsCleared: cleared,
    deferredItems: core.deferredItems,
    delayTrainMin: Math.round(totalDelay),
    baselineDelayTrainMin: Math.round(baseline.delayMin),
    occupancyBudgetMin: days * DAILY_OCCUPANCY_BUDGET_MIN,
    occupancyUsedMin: occupancyUsed,
    noBlockExecuted: 0,
    suspendedByFog: 0,
    withheldByVip: 0,
    conflictsAvoided: baseline.conflicts,
    aiConflicts: score.conflicts,
    frozenBlocks: drafts.filter((b) => b.frozen).length,
    crewWaves: drafts.length,
    replanOf: prevBlockCount,
    blocksKept: unchangedCount,
    h0: 0, h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0, h7: 0,
  };
}

function kindRank(k: DiffKind) {
  return k === "added" ? 0 : k === "moved" ? 1 : k === "dropped" ? 2 : k === "held" ? 3 : 4;
}

/** The plan chain, oldest→newest: what each plan was, and what it did to the one before it. */
export async function planChain(limit = 6) {
  const rows = await db.select().from(plans).orderBy(desc(plans.id)).limit(limit);
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      horizon: r.horizon,
      createdAt: r.createdAt.toISOString(),
      supersedesId: r.supersedesId ?? null,
      triggerNote: r.triggerNote ?? null,
      blocks: (r.kpis?.blocks ?? 0) as number,
      delayTrainMin: (r.kpis?.delayTrainMin ?? 0) as number,
      stabilityPct: ((r.diff as unknown as ReplanDiff | null)?.stabilityPct ?? null) as number | null,
      added: ((r.diff as unknown as ReplanDiff | null)?.added ?? null) as number | null,
      moved: ((r.diff as unknown as ReplanDiff | null)?.moved ?? null) as number | null,
      dropped: ((r.diff as unknown as ReplanDiff | null)?.dropped ?? null) as number | null,
    }))
    .reverse();
}

/** The most recent stored diff, for the panel after a reload (no re-computation, no new plan). */
export async function latestDiff(): Promise<{ diff: ReplanDiff | null; planId: number | null }> {
  const rows = await db.select({ id: plans.id, diff: plans.diff }).from(plans).orderBy(desc(plans.id)).limit(40);
  for (const p of rows) if (p.diff) return { diff: p.diff as unknown as ReplanDiff, planId: p.id };
  return { diff: null, planId: rows[0]?.id ?? null };
}
