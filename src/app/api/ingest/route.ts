import { NextResponse } from "next/server";
import { CONTRACTS, simulateIngest } from "@/lib/integrations/contracts";

export const dynamic = "force-dynamic";

/** GET /api/ingest?system=TMS — runs one contract ingestion cycle. */
export async function GET(req: Request) {
  const system = new URL(req.url).searchParams.get("system");
  if (!system) {
    return NextResponse.json({ contracts: CONTRACTS, note: "Pass ?system=TMS to execute one ingestion cycle" });
  }
  const result = simulateIngest(system);
  if (!result) return NextResponse.json({ error: `unknown system '${system}'` }, { status: 404 });
  return NextResponse.json(result);
}
