import type { ReactNode } from "react";
import { ArrowDownRight, Boxes, Gauge, ShieldCheck, Timer, Zap } from "lucide-react";
import type { DashboardState } from "@/lib/engine/types";

function Card({
  label,
  value,
  sub,
  icon,
  tone,
  spark,
}: {
  label: string;
  value: string;
  sub: string;
  icon: ReactNode;
  tone: string;
  spark?: number[];
}) {
  return (
    <div className="panel group relative overflow-hidden p-4">
      <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-15 blur-2xl" style={{ background: tone }} />
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-dim">{label}</span>
        <span style={{ color: tone }}>{icon}</span>
      </div>
      <div className="tabular mt-2 text-[26px] font-bold leading-none" style={{ color: tone }}>
        {value}
      </div>
      {spark && spark.length > 0 ? (
        <div className="mt-2">
          <div className="flex h-[22px] items-end gap-[2px]">
            {spark.map((h, i) => (
              <div key={i} className="flex-1 rounded-sm transition-all duration-500" style={{ height: `${Math.max(8, (h / Math.max(...spark, 1)) * 100)}%`, background: tone, opacity: 0.35 + (i / spark.length) * 0.5 }} />
            ))}
          </div>
          <div className="mt-1 text-[10px] leading-snug text-faint">{sub}</div>
        </div>
      ) : (
        <div className="mt-1.5 text-[11px] leading-snug text-faint">{sub}</div>
      )}
    </div>
  );
}

export default function KpiStrip({ state }: { state: DashboardState }) {
  const k = state.kpis;
  const hasPlan = !!state.latestPlan;
  const reduction = k.downtimeBaselineH > 0 ? Math.round((1 - k.downtimeOptimizedH / k.downtimeBaselineH) * 100) : 0;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <Card
        label="Asset Downtime"
        value={hasPlan ? `${k.downtimeOptimizedH.toFixed(1)}h` : "—"}
        sub={hasPlan ? `vs ${k.downtimeBaselineH.toFixed(1)}h manual baseline` : "Run optimizer to compute"}
        icon={<Timer size={15} />}
        tone="#f5a524"
      />
      <Card
        label="Downtime ↓"
        value={hasPlan ? `${reduction}%` : "—"}
        sub="single-corridor occupancy"
        icon={<ArrowDownRight size={15} />}
        tone="#34d399"
      />
      <Card
        label="Super-Block Overlap"
        value={hasPlan ? `${k.bundlingPct}%` : "—"}
        sub="ENG+TRD+SNT bundled minutes"
        icon={<Boxes size={15} />}
        tone="#a78bfa"
      />
      <Card
        label="Avg Train Delay"
        value={hasPlan ? `${k.avgDelayMin.toFixed(1)}m` : "—"}
        sub="target < 5 min · baseline 27+ min"
        icon={<Gauge size={15} />}
        tone="#22d3ee"
      />
      <Card
        label="Resilience"
        value={hasPlan ? `${k.resilienceScore}` : "—"}
        sub="500-run Monte Carlo distribution"
        icon={<ShieldCheck size={15} />}
        tone="#34d399"
        spark={state.latestPlan ? [0, 1, 2, 3, 4, 5, 6, 7].map((i) => state.latestPlan!.kpis[`h${i}`] ?? 0) : undefined}
      />
      <Card
        label="Open Defects"
        value={`${state.counts.openDefects}`}
        sub={`${state.counts.criticalDefects} critical · ${state.counts.assetsBelowHealth} assets degraded`}
        icon={<Zap size={15} />}
        tone={state.counts.criticalDefects > 4 ? "#ff4d4f" : "#ff9933"}
      />
    </div>
  );
}
