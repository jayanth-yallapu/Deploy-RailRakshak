import { NextResponse } from "next/server";
import { runFinalBoss } from "@/lib/engine/simulate";
import { ensureSeeded } from "@/lib/engine/seed";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await ensureSeeded();
    const result = await runFinalBoss();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
