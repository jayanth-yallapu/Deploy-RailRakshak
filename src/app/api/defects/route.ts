import { NextResponse } from "next/server";
import { getDefectDTOs } from "@/lib/engine/state";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const defects = await getDefectDTOs();
    return NextResponse.json({ defects });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
