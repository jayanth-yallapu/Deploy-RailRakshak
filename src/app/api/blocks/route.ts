import { NextResponse } from "next/server";
import { db } from "@/db";
import { blockItems, events, segments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { trafficFactor } from "@/lib/engine/network";
import { policyEnv } from "@/lib/engine/optimizer";
import { evaluatePlanPolicy } from "@/lib/engine/policy";

export const dynamic = "force-dynamic";

/** Drag-to-resize a planned block; recomputes its delay cost and returns fresh figures. */
export async function PATCH(req: Request) {
  try {
    const body = (await req.json()) as { id?: number; startMin?: number; endMin?: number };
    const id = Number(body.id);
    const startMin = Math.max(0, Math.min(1410, Math.round(Number(body.startMin))));
    const endMin = Math.max(startMin + 15, Math.min(1440, Math.round(Number(body.endMin))));
    const [b] = await db.select().from(blockItems).where(eq(blockItems.id, id));
    if (!b) return NextResponse.json({ error: "block not found" }, { status: 404 });
    const [seg] = await db.select().from(segments).where(eq(segments.id, b.segmentId));

    const durationH = (endMin - startMin) / 60;
    const tf = trafficFactor((startMin + endMin) / 2);
    const estAffected = Math.max(1, seg.dailyTrains * (durationH / 16) * (0.3 + tf) * (0.5 + tf * 0.2));
    const delayCostMin = Math.round(estAffected * (2.5 + tf * 42) * 10) / 10;
    await db.update(blockItems).set({ startMin, endMin, delayCostMin }).where(eq(blockItems.id, id));

    // Re-check the whole plan, not just this block: moving one party can break the recovery gap for
    // its neighbour or push a night over the divisional occupancy budget, and the block that was
    // dragged is not the one that would show the breach.
    const rows = await db.select().from(blockItems).where(eq(blockItems.planId, b.planId));
    const report = evaluatePlanPolicy(
      rows.map((r) => ({
        id: r.id,
        segmentId: r.segmentId,
        day: r.day,
        startMin: r.startMin,
        endMin: r.endMin,
        departments: r.departments,
        mode: r.mode,
      })),
      await policyEnv()
    );
    const mine = report.perBlock[id];
    // Write the verdict for every block in the plan, not just the dragged one: the recovery gap and
    // the night budget are shared constraints, so a neighbour can go from clean to breaching without
    // being touched. Stale chips on the Gantt are worse than no chips.
    await Promise.all(
      rows.map((r) => {
        const v = report.perBlock[r.id];
        return db
          .update(blockItems)
          .set({
            policy: v ? { score: v.score, violations: v.violations, warnings: v.warnings } : null,
            // A stored override belongs to the breach it was granted for. Once the slot is compliant
            // again it stops being quoted on the block — the event log keeps the history.
            overrideReason: v && v.violations.length === 0 ? null : r.overrideReason,
          })
          .where(eq(blockItems.id, r.id));
      })
    );
    await db.insert(events).values({
      kind: (mine?.violations.length ?? 0) > 0 ? "critical" : (mine?.warnings.length ?? 0) > 0 ? "warn" : "info",
      message: `Control Room resized block #${id} (${seg.code}) to ${String(Math.floor(startMin / 60)).padStart(2, "0")}:${String(startMin % 60).padStart(2, "0")}–${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")} — cascade delay recalculated: ${Math.round(estAffected)} trains, ${Math.round(delayCostMin)} min${
        (mine?.violations.length ?? 0) > 0
          ? ` — POLICY BREACH: ${mine!.violations.join("; ")} (block cannot be published until resolved or overridden)`
          : (mine?.warnings.length ?? 0) > 0
            ? ` — advisory: ${mine!.warnings.join("; ")}`
            : " — policy checks passed"
      }`,
    });
    return NextResponse.json({
      ok: true,
      startMin,
      endMin,
      delayCostMin,
      affected: Math.round(estAffected),
      policy: mine ?? null,
      planPolicy: {
        score: report.score,
        compliantBlocks: report.compliantBlocks,
        hardViolations: report.hardViolations,
        softWarnings: report.softWarnings,
        summary: report.summary,
      },
      // A drag that breaks a hard rule is allowed — the planner is still exploring — but it may not
      // be published, so the response says plainly what is now blocked.
      publishBlocked: (mine?.violations.length ?? 0) > 0,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
