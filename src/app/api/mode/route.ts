import { NextResponse } from "next/server";
import { setSetting } from "@/lib/engine/state";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { key?: string; value?: boolean };
    const key = body.key as "fogMode" | "vipAlert" | "dtpRedZone";
    if (!["fogMode", "vipAlert", "dtpRedZone"].includes(key)) {
      return NextResponse.json({ error: "invalid key" }, { status: 400 });
    }
    await setSetting(key, !!body.value);
    return NextResponse.json({ ok: true, key, value: !!body.value });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
