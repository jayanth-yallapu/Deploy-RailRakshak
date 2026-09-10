import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { blockItems, defects } from "@/db/schema";
import { ensureSeeded } from "@/lib/engine/seed";
import { classify, loadLake, planPool, riskFor, scoreDefect } from "@/lib/engine/optimizer";
import { getLatestPlan } from "@/lib/engine/optimizer";
import { fmtMin } from "@/lib/engine/network";
import { numToSeverity } from "@/lib/engine/severity";

export const dynamic = "force-dynamic";

/**
 * `GET /api/why?defectId=N` — why this item is ranked where it is, and what would have to be true
 * for the answer to change.
 *
 * The counterfactuals are not decorative: each one re-runs the *same* scoring function with one input
 * changed, and — where the change could plausibly flip the decision — re-runs the actual planner
 * (`planPool`) on the modified pool to report whether the item would still have got a block this
 * cycle. That is the difference between "the model says 68.7" and "if this had been reported three
 * weeks later it would not have been planned at all", which is the sentence a divisional officer
 * can check with a calculator.
 */
export async function GET(req: Request) {
  try {
    await ensureSeeded();
    const id = Number(new URL(req.url).searchParams.get("defectId"));
    if (!Number.isFinite(id)) return NextResponse.json({ error: "defectId required" }, { status: 400 });

    const lake = await loadLake();
    // The lake holds this cycle's live pool, so a signed-off or in-progress item is not in it. The
    // question "why was this one closed without a block?" is still worth answering — fall back to the
    // table and say plainly that the planner is not looking at it right now.
    const row = lake.defectRows.find((d) => d.id === id) ?? (await db.select().from(defects).where(eq(defects.id, id)))[0];
    if (!row) return NextResponse.json({ error: `no defect ${id} in the data lake` }, { status: 404 });
    const seg = row.segmentId == null ? undefined : lake.segById.get(row.segmentId);
    if (!seg) return NextResponse.json({ error: "defect has no section — nothing to plan" }, { status: 409 });
    const inPool = lake.defectRows.some((d) => d.id === id);

    const health = lake.healthFor(row);
    const base = scoreDefect(
      { severity: row.severity, overdueDays: row.overdueDays, inspectionMode: row.inspectionMode },
      { criticality: seg.criticality, dailyTrains: seg.dailyTrains, isBridge: seg.isBridge },
      { fogMode: lake.fogMode, assetHealth: health }
    );

    const { reasons, schedulable } = classify(lake);
    const rank = schedulable.findIndex((c) => c.d.id === id);
    const plan = await getLatestPlan();
    const stored = plan
      ? await db.select().from(blockItems).where(eq(blockItems.planId, plan.id))
      : [];
    const home = stored.find((b) => b.defectIds.includes(id));

    /** Re-place the whole pool with one input changed, and report what the planner did with it. */
    const counterfactual = (
      label: string,
      patch: { overdueDays?: number; severity?: number; assetHealth?: number; fogMode?: boolean }
    ) => {
      const next = scoreDefect(
        {
          severity: patch.severity ?? row.severity,
          overdueDays: patch.overdueDays ?? row.overdueDays,
          inspectionMode: row.inspectionMode,
        },
        { criticality: seg.criticality, dailyTrains: seg.dailyTrains, isBridge: seg.isBridge },
        { fogMode: patch.fogMode ?? lake.fogMode, assetHealth: patch.assetHealth ?? health }
      );
      const out: Record<string, unknown> = {
        label,
        score: next.score,
        delta: Math.round((next.score - base.score) * 10) / 10,
        risk: Math.round(next.risk * 1000) / 1000,
        riskPct: Math.round(next.risk * 100),
        baseRiskPct: Math.round(base.risk * 100),
      };
      if (!inPool) {
        out.planEffect = "outside the pool this cycle — the planner is never shown this item";
        return out;
      }
      if (row.requiresBlock) {
        try {
          // Rebuild the pool exactly as `classify` sees it, with this one item's inputs changed. The
          // health override goes through `healthFor` rather than by mutating the shared asset map:
          // a counterfactual must not be able to alter the live lake for anybody else's request.
          const altLake = {
            ...lake,
            fogMode: patch.fogMode ?? lake.fogMode,
            defectRows: lake.defectRows.map((d) =>
              d.id === id
                ? {
                    ...d,
                    overdueDays: patch.overdueDays ?? d.overdueDays,
                    // Rows store severity as a label; the engine accepts either, but the lake type
                    // does not, so convert back through the one place that owns that mapping.
                    severity: patch.severity == null ? d.severity : numToSeverity(patch.severity),
                  }
                : d
            ),
            healthFor:
              patch.assetHealth == null
                ? lake.healthFor
                : (d: Parameters<typeof lake.healthFor>[0]) =>
                    d.id === id ? (patch.assetHealth as number) : lake.healthFor(d),
          };
          const alt = classify(altLake);
          const placed = planPool(alt.schedulable, 7, { fogMode: altLake.fogMode });
          const hit = placed.drafts.find((b) => b.defectIds.includes(id));
          const inPool = alt.schedulable.some((c) => c.d.id === id);
          out.stillInPool = inPool;
          out.planEffect = hit
            ? `still planned this cycle — D+${hit.day} ${fmtMin(hit.startMin)} on ${seg.code}`
            : inPool
              ? placed.deferredItems > 0
                ? `would NOT be planned this cycle — the night budget went to higher-priority work (${placed.deferredItems} item(s) deferred)`
                : "would NOT be planned this cycle — no feasible slot left"
              : "would leave the candidate pool entirely (suspended by a standing order, not by capacity)";
          const altRank = alt.schedulable.findIndex((c) => c.d.id === id) + 1;
          out.rank = altRank > 0 ? altRank : null;
        } catch (e) {
          out.planEffect = `could not be evaluated (${String(e).slice(0, 60)})`;
        }
      }

      return out;
    };

    const sevNum = base.severity;
    const variants = [
      counterfactual("if it had been reported on time (0 days overdue)", { overdueDays: 0 }),
      counterfactual("if severity were one band lower", { severity: Math.max(1, sevNum - 2) }),
      counterfactual("if the asset were in perfect health (100)", { assetHealth: 100 }),
      counterfactual("if it had been left another 30 days", { overdueDays: (row.overdueDays ?? 0) + 30 }),
    ];
    if (lake.fogMode) variants.push(counterfactual("if fog mode were off", { fogMode: false }));

    return NextResponse.json({
      defect: {
        id: row.id,
        title: row.title,
        note: row.note,
        department: row.department,
        severity: row.severity,
        status: row.status,
        overdueDays: row.overdueDays,
        durationMin: row.durationMin,
        inspectionMode: row.inspectionMode,
        requiresBlock: row.requiresBlock,
        assetHealth: health,
        section: { code: seg.code, criticality: seg.criticality, dailyTrains: seg.dailyTrains, isBridge: seg.isBridge },
      },
      score: { score: base.score, risk: base.risk, terms: base.contributions },
      rank: rank >= 0 ? { position: rank + 1, pool: schedulable.length } : null,
      gate: inPool
        ? reasons.get(id) ?? { reason: "in_pool", detail: "in this cycle's pool" }
        : {
            reason: "outside_pool",
            detail: `Status "${row.status}" — the planner is not offered this item this cycle, so rank and placement do not apply.`,
          },
      placedIn: home
        ? {
            blockItemId: home.id,
            when: `D+${home.day} ${fmtMin(home.startMin)}–${fmtMin(home.endMin)}`,
            window: home.window,
            departments: home.departments,
            policyScore: (home.policy as { score?: number } | null)?.score ?? null,
          }
        : null,
      settings: { fogMode: lake.fogMode, vipAlert: lake.vipAlert },
      counterfactuals: variants,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
