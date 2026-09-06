import { NextResponse } from "next/server";
import { generateSafetyOrder } from "@/lib/engine/simulate";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { blockItemId?: number };
    const result = await generateSafetyOrder(Number(body.blockItemId));
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
