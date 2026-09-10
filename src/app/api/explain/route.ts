import { NextResponse } from "next/server";
import { db } from "@/db";
import { blockItems, defects } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { ensureSeeded } from "@/lib/engine/seed";
import { getLatestPlan, policyEnv } from "@/lib/engine/optimizer";
import { evaluatePlanPolicy } from "@/lib/engine/policy";
import { fmtMin } from "@/lib/engine/network";

export const dynamic = "force-dynamic";

/**
 * `GET /api/explain?blockItemId=123` — the audit note behind one planned occupation.
 *
 * The panel answers three separate questions, because a jury asks them separately:
 *   · why does this block exist at all  → the defect that drives it, with its objective terms;
 *   · why this night and hour          → the placement the search examined and rejected, and what it cost;
 *   · why this length                  → the department chains packed into the block, plus the lock-on.
 *
 * It is deliberately not a re-generation of the plan: the numbers come from the row the plan was
 * published with, so the explanation cannot drift away from what is on the Gantt. Anything the row
 * does not know (the current compliance verdict, the delay the *dragged* slot now implies) is
 * recomputed and labelled as such.
 */
export async function GET(req: Request) {
  try {
    await ensureSeeded();
    const url = new URL(req.url);
    const plan = await getLatestPlan();
    if (!plan) return NextResponse.json({ error: "no plan yet — run the optimizer" }, { status: 404 });

    const rows = await db.select().from(blockItems).where(eq(blockItems.planId, plan.id));
    const wanted = url.searchParams.get("blockItemId");
    const row = wanted ? rows.find((r) => r.id === Number(wanted)) : rows[0];
    if (!row) return NextResponse.json({ error: `block ${wanted ?? ""} not in the current plan` }, { status: 404 });

    const [block] = plan.blocks.filter((b) => b.id === row.id);
    const drows = row.defectIds.length
      ? await db.select().from(defects).where(inArray(defects.id, row.defectIds))
      : [];

    const env = await policyEnv();
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
      env
    );
    const mine = report.perBlock[row.id];
    const stored = (row.explain ?? null) as {
      why?: string[];
      terms?: { name: string; value: number }[];
      drivingDefect?: { id: number; title: string; score: number };
      chosen?: { day: number; startMin: number; endMin: number; window: string; delayCostMin: number; affectedTrains: number };
      runnerUp?: { label: string; cost: number; penaltyVsChosen: number } | null;
      budget?: { day: number; usedMin: number; limitMin: number };
      bundling?: { departments: string[]; separateBlockMin: number; bundledBlockMin: number; savedMin: number };
    } | null;

    const moved =
      !!stored?.chosen && (stored.chosen.startMin !== row.startMin || stored.chosen.endMin !== row.endMin || stored.chosen.day !== row.day);

    return NextResponse.json({
      planId: plan.id,
      blockItemId: row.id,
      segmentCode: block?.segmentCode ?? null,
      corridor: block?.corridor ?? null,
      now: {
        day: row.day,
        startMin: row.startMin,
        endMin: row.endMin,
        clock: `${fmtMin(row.startMin)}–${fmtMin(row.endMin)}`,
        durationMin: row.endMin - row.startMin,
        departments: row.departments,
        mode: row.mode,
        window: row.window,
        delayCostMin: row.delayCostMin,
        isSuperBlock: row.isSuperBlock,
      },
      generated: stored,
      // true when a human has moved the block since the solver placed it: the reasoning below still
      // explains the *chosen* slot, and the current figures are shown separately rather than rewritten.
      editedByHuman: moved,
      defects: drows.map((d) => ({
        id: d.id,
        title: d.title,
        severity: d.severity,
        department: d.department,
        overdueDays: d.overdueDays,
        durationMin: d.durationMin,
        status: d.status,
      })),
      compliance: mine
        ? {
            score: mine.score,
            violations: mine.violations,
            warnings: mine.warnings,
            results: mine.results,
            overrideReason: row.overrideReason,
          }
        : null,
      planPolicy: {
        score: report.score,
        compliantBlocks: report.compliantBlocks,
        hardViolations: report.hardViolations,
        softWarnings: report.softWarnings,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
