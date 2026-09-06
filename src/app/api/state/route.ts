import { NextResponse } from "next/server";
import { getDashboardState } from "@/lib/engine/state";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await getDashboardState();
    return NextResponse.json(state);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
