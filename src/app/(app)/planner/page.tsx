import { getDashboardState } from "@/lib/engine/state";
import PlannerClient from "@/components/PlannerClient";

export const dynamic = "force-dynamic";

export default async function PlannerPage() {
  const state = await getDashboardState();
  return <PlannerClient initial={state} />;
}
