import { getDashboardState } from "@/lib/engine/state";
import { getJobs } from "@/lib/engine/jobs";
import JobsClient from "@/components/JobsClient";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const [state, jobs] = await Promise.all([getDashboardState(), getJobs()]);
  return <JobsClient initialState={state} initialJobs={jobs} />;
}
