import { getDashboardState } from "@/lib/engine/state";
import { getJobs } from "@/lib/engine/jobs";
import FieldClient from "@/components/FieldClient";

export const dynamic = "force-dynamic";

export default async function FieldPage() {
  const [state, jobs] = await Promise.all([getDashboardState(), getJobs()]);
  return <FieldClient initialState={state} initialJobs={jobs} />;
}
