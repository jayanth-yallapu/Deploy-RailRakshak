import { NextResponse } from "next/server";
import { ensureSeeded, seed } from "@/lib/engine/seed";

export const dynamic = "force-dynamic";

/**
 * Data-lake control for demos and CI.
 *
 *  · `GET /api/seed`  → verify the lake is complete, repairing it if it is not (idempotent).
 *  · `POST /api/seed` `{ force: true }` → rebuild the whole grid + backlog from `network.ts`.
 *
 * The forced rebuild matters for both the harness and the booth: running the optimiser marks
 * backlog items `scheduled`, so a second "Generate plan" click on the same lake has less to do.
 * Reset first and every demo run starts from the same deterministic dataset, which is also what
 * lets `scripts/verify.mjs` be a repeatable regression gate instead of a one-shot check.
 */
export async function GET() {
  try {
    await ensureSeeded();
    return NextResponse.json({ success: true, message: "Data lake verified (repaired if incomplete)." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "seed verification failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { force?: boolean };
  if (!body.force) {
    return NextResponse.json(
      { success: false, error: "Pass { force: true } to rebuild the demo data lake. This truncates plans, blocks, jobs and defects." },
      { status: 400 }
    );
  }
  try {
    const shape = await seed();
    return NextResponse.json({ success: true, rebuilt: true, ...shape });
  } catch (error) {
    const message = error instanceof Error ? error.message : "rebuild failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
