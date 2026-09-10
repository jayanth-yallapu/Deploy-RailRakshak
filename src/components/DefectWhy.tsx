"use client";

import { useEffect, useState } from "react";
import { GitCompareArrows, HelpCircle, MapPin } from "lucide-react";

interface Why {
  defect: {
    id: number;
    title: string;
    severity: string;
    status: string;
    overdueDays: number;
    durationMin: number;
    assetHealth: number;
    requiresBlock: boolean;
    inspectionMode: string;
    section: { code: string; criticality: number; dailyTrains: number; isBridge: boolean };
  };
  score: { score: number; risk: number; terms: { name: string; value: number }[] };
  rank: { position: number; pool: number } | null;
  gate: { reason: string; detail: string };
  placedIn: { blockItemId: number; when: string; window: string; departments: string[]; policyScore: number | null } | null;
  settings: { fogMode: boolean; vipAlert: boolean };
  counterfactuals: {
    label: string;
    score: number;
    delta: number;
    riskPct: number;
    baseRiskPct: number;
    rank?: number | null;
    planEffect?: string;
    stillInPool?: boolean;
  }[];
}

/** Tone per gate reason, so "suspended by a standing order" never looks like "ran out of capacity". */
const GATE_TONE: Record<string, string> = {
  in_pool: "text-slate-300",
  no_block: "text-sky-300",
  fog_suspended: "text-amber-300",
  vip_withheld: "text-rose-300",
  outside_pool: "text-slate-400",
  closed: "text-slate-500",
};

/**
 * One backlog item, the arithmetic behind its rank, and what would change it.
 *
 * Every figure below is recomputed by the server on open — including the counterfactuals, each of
 * which re-runs the planner on the modified pool. Nothing here is canned, which is the point: the
 * panel can be interrogated with "and if I had reported it a month later?" and answer honestly.
 */
export default function DefectWhy({ defectId }: { defectId: number }) {
  const [data, setData] = useState<Why | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/why?defectId=${defectId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Why) => {
        if (!cancelled) {
          setData(d);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [defectId]);

  const current = data && data.defect.id === defectId ? data : null;

  if (failed && !current)
    return (
      <p className="border-t border-edge px-4 py-2 text-[11px] text-rose-300">
        The reasoning service did not answer for item #{defectId}.
      </p>
    );
  if (!current)
    return (
      <p className="border-t border-edge px-4 py-2 text-[11px] text-faint">
        Re-scoring item #{defectId} and re-running the planner for each counterfactual…
      </p>
    );

  const maxTerm = Math.max(...current.score.terms.map((t) => Math.abs(t.value)), 1);

  return (
    <div className="anim-rise space-y-3 border-t border-edge bg-[#080d16] px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-ink">
          <HelpCircle size={12} className="text-amber-400" /> why rank {current.rank ? `#${current.rank.position}` : "—"}
        </span>
        <span className="font-mono text-[11px] text-dim">
          {current.defect.section.code} · {current.defect.severity} · {current.defect.overdueDays} d overdue · asset{" "}
          {current.defect.assetHealth}/100{current.defect.section.isBridge ? " · bridge" : ""}
        </span>
        <span className={`text-[11px] ${GATE_TONE[current.gate.reason] ?? "text-slate-300"}`}>{current.gate.detail}</span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_1.15fr]">
        <div>
          <ul className="space-y-0.5">
            {current.score.terms.map((t) => (
              <li key={t.name} className="flex items-center gap-2 text-[11px]">
                <span className="w-36 shrink-0 truncate text-dim">{t.name}</span>
                <span className="h-1.5 rounded-sm" style={{ width: `${Math.max(3, (Math.abs(t.value) / maxTerm) * 100)}%`, background: t.value >= 0 ? "rgba(245,158,11,.75)" : "rgba(56,189,248,.7)" }} />
                <span className="tabular ml-auto font-mono text-[10px] text-faint">
                  {t.value > 0 ? "+" : ""}
                  {Math.round(t.value)}
                </span>
              </li>
            ))}
            <li className="mt-1 flex items-center justify-between border-t border-edge pt-1 text-[11px]">
              <span className="font-semibold text-ink">priority score</span>
              <span className="tabular font-mono text-amber-300">
                {current.score.score} · 72 h risk {Math.round(current.score.risk * 100)}%
              </span>
            </li>
          </ul>
          {current.placedIn ? (
            <p className="mt-2 flex items-start gap-1.5 text-[11px] text-dim">
              <MapPin size={12} className="mt-0.5 shrink-0 text-emerald-400" />
              <span>
                placed in block #{current.placedIn.blockItemId} · {current.placedIn.when} · {current.placedIn.departments.join("+")} ·{" "}
                {current.placedIn.window}
                {current.placedIn.policyScore != null && (
                  <span className={current.placedIn.policyScore >= 97 ? "text-emerald-400" : "text-rose-400"}>
                    {" "}
                    · policy {current.placedIn.policyScore}
                  </span>
                )}
              </span>
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-faint">
              {current.defect.requiresBlock
                ? "Not in the published plan for this cycle — see the gate note above."
                : "Cleared without a block: this item never consumes a night."}
            </p>
          )}
        </div>

        <div>
          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-faint">
            <GitCompareArrows size={11} /> what would have to be different
          </p>
          <ul className="space-y-1">
            {current.counterfactuals.map((c) => (
              <li key={c.label} className="rounded border border-edge bg-hull px-2 py-1.5 text-[11px]">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-ink">{c.label}</span>
                  <span className={`tabular font-mono ${c.delta > 0 ? "text-rose-400" : c.delta < 0 ? "text-emerald-400" : "text-faint"}`}>
                    {c.delta > 0 ? "+" : ""}
                    {c.delta} score
                  </span>
                  <span className="tabular font-mono text-faint">
                    risk {c.baseRiskPct}% → {c.riskPct}%
                  </span>
                  {c.rank != null && <span className="font-mono text-faint">rank {current.rank?.position ?? "—"} → {c.rank}</span>}
                </div>
                {c.planEffect && (
                  <p className="mt-0.5 text-[10px] leading-relaxed text-dim">
                    {c.delta === 0 && c.planEffect.startsWith("still") ? "no decision change — " : ""}
                    {c.planEffect}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] leading-relaxed text-faint">
            Each line re-scores the item and re-runs the placement search over the whole pool
            {current.settings.fogMode ? " (fog mode is currently ON" : " (fog mode is off"}
            {current.settings.vipAlert ? ", VVIP alert ON" : ""}
            {")"} — so the ranking above is what the same data would produce under that assumption, not an
            approximation of it.
          </p>
        </div>
      </div>
    </div>
  );
}
