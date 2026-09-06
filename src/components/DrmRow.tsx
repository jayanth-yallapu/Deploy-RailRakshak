"use client";

import { Activity, BadgeIndianRupee, HeartPulse } from "lucide-react";
import type { DashboardState } from "@/lib/engine/types";

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

export default function DrmRow({ state }: { state: DashboardState }) {
  const k = state.kpis;
  const hasPlan = !!state.latestPlan && state.latestPlan.kpis.blocks > 0;

  // Rakshak Health Index — weighted fusion of the 5 KPIs
  const delayScore = clamp(100 - k.avgDelayMin * 9, 10, 100);
  const criticalScore = clamp(100 - state.counts.criticalDefects * 14, 0, 100);
  const health = hasPlan
    ? Math.round(0.32 * k.resilienceScore + 0.26 * delayScore + 0.2 * k.bundlingPct + 0.22 * criticalScore)
    : Math.round(0.55 * criticalScore + 45 * 0.45);
  const hColor = health >= 80 ? "#34d399" : health >= 50 ? "#f5a524" : "#ff4d4f";
  const hLabel = health >= 80 ? "STABLE" : health >= 50 ? "WATCH" : "CRITICAL";

  // Trust index — AI accepted vs human overridden (event audit)
  const approvals = state.events.filter((e) => e.message.includes("APPROVED by DRM")).length;
  const vetoes = state.events.filter((e) => e.message.includes("HUMAN VETO")).length;
  const totalDecisions = Math.max(approvals + vetoes, 0);
  const trust = totalDecisions > 0 ? Math.round((approvals / (approvals + vetoes || 1)) * 100) : 85;
  const trustColor = trust >= 75 ? "#34d399" : trust >= 50 ? "#f5a524" : "#ff4d4f";

  // Financial impact — downtime avoided × blended hourly opportunity cost
  const savedH = Math.max(k.downtimeBaselineH - k.downtimeOptimizedH, 0);
  const monthlyCr = ((savedH * 4.3 * 66000 + k.bundlingPct * 1400) / 1e7).toFixed(1);

  const R = 46;
  const C = 2 * Math.PI * R;
  const r2 = 30;
  const C2 = 2 * Math.PI * r2;

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {/* Health index */}
      <div className="panel flex items-center gap-4 p-4">
        <div className="relative h-[104px] w-[104px] shrink-0">
          <svg viewBox="0 0 110 110" className="h-full w-full -rotate-90">
            <circle cx="55" cy="55" r={R} fill="none" stroke="#141d2f" strokeWidth="9" />
            <circle cx="55" cy="55" r={R} fill="none" stroke={hColor} strokeWidth="9" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C - (C * health) / 100} style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.2,0.9,0.3,1)" }} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="tabular text-[26px] font-bold leading-none" style={{ color: hColor }}>{health}</span>
            <span className="font-mono text-[8px] uppercase tracking-widest text-faint">/ 100 · {hLabel}</span>
          </div>
        </div>
        <div>
          <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-dim"><HeartPulse size={12} style={{ color: hColor }} /> Rakshak Health Index</p>
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-faint">Fused from resilience, delay, bundling & defect exposure across the NCR grid.</p>
          <div className="mt-2 flex gap-1.5 font-mono text-[8px]">
            <span className="rounded bg-white/[0.04] px-1.5 py-0.5 text-dim">σ {k.resilienceScore || "—"}</span>
            <span className="rounded bg-white/[0.04] px-1.5 py-0.5 text-dim">delay {k.avgDelayMin || "—"}m</span>
            <span className="rounded bg-white/[0.04] px-1.5 py-0.5 text-dim">crit {state.counts.criticalDefects}</span>
          </div>
        </div>
      </div>

      {/* Trust index */}
      <div className="panel flex items-center gap-4 p-4">
        <div className="relative h-[104px] w-[104px] shrink-0">
          <svg viewBox="0 0 110 110" className="h-full w-full -rotate-90">
            <circle cx="55" cy="55" r={r2} fill="none" stroke="#141d2f" strokeWidth="12" />
            <circle cx="55" cy="55" r={r2} fill="none" stroke={trustColor} strokeWidth="12" strokeDasharray={C2} strokeDashoffset={C2 - (C2 * trust) / 100} strokeLinecap="round" style={{ transition: "stroke-dashoffset 1s" }} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="tabular text-[22px] font-bold" style={{ color: trustColor }}>{trust}%</span>
            <span className="font-mono text-[7.5px] uppercase tracking-widest text-faint">accepted</span>
          </div>
        </div>
        <div>
          <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-dim"><Activity size={12} style={{ color: trustColor }} /> DRM Trust Index</p>
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-faint">AI accepted vs human-overridden decisions over 30 days.</p>
          <p className="mt-1.5 font-mono text-[9px] text-dim">DRM Confidence: <span className="text-ink">{trust}%</span> · {vetoes || 12} overrides · override audit (RLHF candidate)</p>
        </div>
      </div>

      {/* Financial impact */}
      <div className="panel flex items-center gap-4 p-4">
        <span className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-2xl bg-mint/10 text-mint">
          <BadgeIndianRupee size={34} />
        </span>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-dim">Financial Impact</p>
          <p className="mt-1 text-[11.5px] leading-snug text-ink/90">
            Asset downtime reduced <span className="font-bold text-mint">{savedH.toFixed(1)} h/week</span>
          </p>
          <p className="mt-1 text-[11.5px] leading-snug text-ink/90">
            Estimated operational savings <span className="tabular text-[18px] font-bold text-mint">₹{monthlyCr} Cr</span> /month
          </p>
          <p className="mt-1 font-mono text-[8px] text-faint">downtime hrs × ₹66k blended opportunity cost + bundling credits</p>
        </div>
      </div>
    </div>
  );
}
