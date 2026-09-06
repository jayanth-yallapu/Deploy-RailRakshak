import { getDashboardState } from "@/lib/engine/state";
import WhatIfLab from "@/components/WhatIfLab";
import CrisisConsole from "@/components/CrisisConsole";

export const dynamic = "force-dynamic";

export default async function SimulationPage() {
  const state = await getDashboardState();
  return (
    <div className="anim-rise space-y-4">
      <WhatIfLab stations={state.stations} segments={state.segments} fog={state.settings.fogMode} />
      <CrisisConsole />
    </div>
  );
}
