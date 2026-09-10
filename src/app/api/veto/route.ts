import { NextResponse } from "next/server";
import { setPlanStatus } from "@/lib/engine/jobs";
import { db } from "@/db";
import { blockItems, events } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getLatestPlan, policyEnv } from "@/lib/engine/optimizer";
import { evaluatePlanPolicy } from "@/lib/engine/policy";
import { fmtMin } from "@/lib/engine/network";

export const dynamic = "force-dynamic";

/**
 * The DRM's decision on a proposed plan.
 *
 * `mode: "APPROVED"` publishes it — and only if the block-policy rule book is satisfied. A plan with
 * a hard breach (someone dragged a block into traffic hours, a VVIP movement got notified after the
 * plan was cut, a night is now over its occupancy budget) is refused with `409` and the list of what
 * must change. It can still be approved, but only with an explicit `overrideReason`, which is written
 * onto the offending blocks and into the audit trail. That is the whole point of the gate: not
 * "the AI is always right", but "nothing reaches the crews without a named human accepting it".
 *
 * `VETOED` / `PROPOSED` never need the gate: refusing to publish cannot breach a safety rule.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { mode?: string; reason?: string; note?: string; overrideReason?: string };
    const mode = body.mode === "VETOED" ? "VETOED" : body.mode === "APPROVED" ? "APPROVED" : "PROPOSED";

    if (mode === "APPROVED") {
      const plan = await getLatestPlan();
      if (plan) {
        const rows = await db.select().from(blockItems).where(eq(blockItems.planId, plan.id));
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
        const breaches = rows
          .filter((r) => (report.perBlock[r.id]?.violations.length ?? 0) > 0)
          .map((r) => ({
            blockItemId: r.id,
            segmentCode: plan.blocks.find((b) => b.id === r.id)?.segmentCode ?? `#${r.segmentId}`,
            when: `D+${r.day} ${fmtMin(r.startMin)}–${fmtMin(r.endMin)}`,
            violations: report.perBlock[r.id].violations,
          }));

        if (breaches.length > 0 && !body.overrideReason?.trim()) {
          await db.insert(events).values({
            kind: "critical",
            message: `Publication refused — ${breaches.length} block(s) breach the block rule book; DRM approval requires a recorded override reason`,
          });
          return NextResponse.json(
            {
              error: `Cannot publish: ${breaches.length} block(s) breach the rule book`,
              breaches,
              policyScore: report.score,
              hint: "Fix the flagged blocks on the Gantt, or approve with an override reason (recorded in the audit trail).",
            },
            { status: 409 }
          );
        }

        if (breaches.length > 0 && body.overrideReason?.trim()) {
          await Promise.all(
            breaches.map((b) => db.update(blockItems).set({ overrideReason: body.overrideReason!.trim() }).where(eq(blockItems.id, b.blockItemId)))
          );
          await db.insert(events).values({
            kind: "critical",
            message: `DRM OVERRIDE on ${breaches.length} non-compliant block(s) — "${body.overrideReason.trim()}" — recorded in the override audit trail (RLHF candidate set): ${breaches
              .map((b) => `${b.segmentCode} ${b.when}`)
              .join(", ")}`,
          });
        }
      }
    }

    await setPlanStatus(mode, body.reason, body.note);
    return NextResponse.json({ ok: true, planStatus: mode });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
