import { NextResponse } from "next/server";
import { getDefects } from "@/lib/engine/state";

export const dynamic = "force-dynamic";

/**
 * Backlog queue for the planner and the inspector screens.
 *
 * Two things were wrong here before: the handler re-mapped raw rows with snake_case keys
 * (`d.segment_id`, `d.overdue_days`, …) that Drizzle does not return — so the payload was full of
 * nulls and the build did not compile — and it returned a bare array while `PlannerClient` and
 * `SectionInspector` read `data.defects`, so the planner queue was permanently empty.
 *
 * Now: the engine's DTO builder is the only mapping (it adds model risk + section code), and the
 * response is `{ defects, count }` — the shape every consumer already expects.
 */
export async function GET() {
  try {
    const defects = await getDefects();
    return NextResponse.json({ defects, count: defects.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message, defects: [], count: 0 }, { status: 500 });
  }
}
