import { getDashboardState } from "@/lib/engine/state";
import CommandClient from "@/components/CommandClient";

export const dynamic = "force-dynamic";

export default async function CommandPage() {
  const state = await getDashboardState();
  return <CommandClient initial={state} />;
}
