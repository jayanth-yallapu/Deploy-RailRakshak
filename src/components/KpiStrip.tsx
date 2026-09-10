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
    <div className="panel flex flex-col justify-between p-4 transition hover:border-edge/90">
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-dim">{label}</span>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-hull border border-edge/60" style={{ color: tone }}>
            {icon}
          </span>
        </div>
        <div className="tabular mt-2.5 text-2xl font-bold tracking-tight text-ink font-mono" style={{ color: tone }}>
          {value}
        </div>
      </div>

      {spark && spark.length > 0 ? (
        <div className="mt-3">
          <div className="flex h-5 items-end gap-1">
            {spark.map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-sm transition-all duration-300"
                style={{
                  height: `${Math.max(12, (h / Math.max(...spark, 1)) * 100)}%`,
                  backgroundColor: tone,
                  opacity: 0.3 + (i / spark.length) * 0.5,
                }}
              />
            ))}
          </div>
          <div className="mt-1.5 text-[11px] text-faint leading-snug truncate">{sub}</div>
        </div>
      ) : (
        <div className="mt-2 text-[11px] text-faint leading-snug">{sub}</div>
      )}
    </div>
  );
}

export default function KpiStrip({ state }: { state: DashboardState }) {
  const plan = state.latestPlan;
  const hasPlan = !!plan;

  // KPIs are in plan.kpis; resilienceScore is a top-level field on the plan
  const kpis = (plan?.kpis ?? {}) as Record<string, number>;
  const downtimeOptimizedH = kpis.downtimeOptimizedH ?? state.kpis.downtimeOptimizedH ?? 0;
  const downtimeBaselineH = kpis.downtimeBaselineH ?? state.kpis.downtimeBaselineH ?? 0;
  const bundlingPct = kpis.bundlingPct ?? state.kpis.bundlingPct ?? 0;
  const avgDelayMin = kpis.avgDelayMin ?? state.kpis.avgDelayMin ?? 0;
  // resilienceScore lives on plan.resilienceScore, not inside kpis JSON
  const resilienceScore = plan?.resilienceScore ?? state.kpis.resilienceScore ?? 0;

  const reduction = downtimeBaselineH > 0 ? Math.round((1 - downtimeOptimizedH / downtimeBaselineH) * 100) : 0;

  // Build histogram sparkline from h0..h7 keys stored in kpis JSONB
  const spark = hasPlan
    ? [0, 1, 2, 3, 4, 5, 6, 7].map((i) => kpis[`h${i}`] ?? 0)
    : undefined;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <Card
        label="Asset Downtime"
        value={hasPlan ? `${downtimeOptimizedH.toFixed(1)}h` : "—"}
        sub={hasPlan ? `vs ${downtimeBaselineH.toFixed(1)}h manual baseline` : "Run optimizer to calculate"}
        icon={<Timer size={14} />}
        tone="#f59e0b"
      />
      <Card
        label="Downtime Reduction"
        value={hasPlan ? `${reduction}%` : "—"}
        sub="Single-corridor bundled occupancy"
        icon={<ArrowDownRight size={14} />}
        tone="#10b981"
      />
      <Card
        label="Super-Block Overlap"
        value={hasPlan ? `${bundlingPct}%` : "—"}
        sub="Multi-department shared minutes"
        icon={<Boxes size={14} />}
        tone="#8b5cf6"
      />
      <Card
        label="Avg Train Delay"
        value={hasPlan ? `${avgDelayMin.toFixed(1)}m` : "—"}
        sub="Target < 8 min · baseline 28+ min"
        icon={<Gauge size={14} />}
        tone="#0ea5e9"
      />
      <Card
        label="Resilience Index"
        value={hasPlan ? `${resilienceScore.toFixed(1)}/100` : "—"}
        sub="500 Monte Carlo stress runs"
        icon={<ShieldCheck size={14} />}
        tone="#10b981"
        spark={spark}
      />
      <Card
        label="Open Defects"
        value={`${state.counts.openDefects}`}
        sub={`${state.counts.criticalDefects} critical · ${state.counts.assetsBelowHealth} degraded`}
        icon={<Zap size={14} />}
        tone={state.counts.criticalDefects > 4 ? "#f43f5e" : "#f59e0b"}
      />
    </div>
  );
}
