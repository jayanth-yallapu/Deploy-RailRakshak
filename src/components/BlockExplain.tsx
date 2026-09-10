"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Clock, Layers, Scale, X } from "lucide-react";
import { fmtMin } from "@/lib/engine/network";

interface Explain {
  blockItemId: number;
  segmentCode: string | null;
  corridor: string | null;
  now: {
    day: number;
    startMin: number;
    endMin: number;
    clock: string;
    durationMin: number;
    departments: string[];
    mode: string;
    window: string;
    delayCostMin: number;
    isSuperBlock: boolean;
  };
  editedByHuman: boolean;
  generated: {
    why: string[];
    terms: { name: string; value: number }[];
    drivingDefect: { id: number; title: string; score: number; severity: number; risk: number };
    chosen: { day: number; startMin: number; endMin: number; window: string; delayCostMin: number; affectedTrains: number };
    runnerUp: { label: string; cost: number; penaltyVsChosen: number } | null;
    budget: { day: number; usedMin: number; limitMin: number };
    bundling: { departments: string[]; separateBlockMin: number; bundledBlockMin: number; savedMin: number };
  } | null;
  defects: { id: number; title: string; severity: string; department: string; overdueDays: number; durationMin: number }[];
  compliance: {
    score: number;
    violations: string[];
    warnings: string[];
    overrideReason: string | null;
    results: { id: string; label: string; clause: string; severity: string; ok: boolean; detail: string }[];
  } | null;
}

const Bar = ({ v, max, tone }: { v: number; max: number; tone: string }) => (
  <span className="inline-block h-1.5 rounded-sm" style={{ width: `${Math.max(4, Math.min(100, (Math.abs(v) / Math.max(max, 1)) * 100))}%` }}>
    <span className={`block h-full rounded-sm ${tone}`} />
  </span>
);

/**
 * "Why this block, here, at this length?" — the audit note the solver wrote for one occupation.
 *
 * Nothing here is computed in the browser: every figure comes from `GET /api/explain`, which reads
 * the numbers the search actually traded off (stored on the block row at publication) and re-runs the
 * rule book over the *current* slot. If a human has dragged the block since, both are shown side by
 * side rather than the explanation being quietly rewritten to match the edit.
 */
export default function BlockExplain({ blockItemId }: { blockItemId: number }) {
  const [data, setData] = useState<Explain | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/explain?blockItemId=${blockItemId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Explain) => {
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
  }, [blockItemId]);

  // The row is keyed by block, so a previous block's note is never shown while a new one loads —
  // no reset-in-effect needed, which is also what keeps this off the cascading-render lint rule.
  const current: Explain | null = data && data.blockItemId === blockItemId ? data : null;

  if (failed && !current) return <p className="px-4 py-2 text-[11px] text-rose-300">Explanation unavailable — the audit note could not be read.</p>;
  if (!current) return <p className="px-4 py-2 text-[11px] text-faint">Reading the audit note for block #{blockItemId}…</p>;

  const g = current.generated;
  const maxTerm = g ? Math.max(...g.terms.map((t) => Math.abs(t.value)), 1) : 1;
  const moved = current.editedByHuman && g;

  return (
    <div className="anim-rise border-t border-edge bg-[#080d16] px-5 py-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-xs font-bold uppercase tracking-wider text-ink">Why this block</span>
        <span className="font-mono text-[11px] text-dim">
          {current.segmentCode}
          {current.corridor ? ` · ${current.corridor}` : ""} · D+{current.now.day} {current.now.clock} · {current.now.durationMin} min ·{" "}
          {current.now.departments.join("+")}
        </span>
        {moved && (
          <span className="flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
            <AlertTriangle size={11} /> moved by hand since the solver placed it
          </span>
        )}
        <span className="ml-auto text-[10px] uppercase tracking-wider text-faint">block #{current.blockItemId}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <div className="space-y-3">
          {g ? (
            <>
              <ul className="space-y-1">
                {g.why.map((w) => (
                  <li key={w} className="flex gap-2 text-[11px] leading-relaxed text-dim">
                    <span className="mt-[3px] text-amber-400">▸</span>
                    <span>{w}</span>
                  </li>
                ))}
              </ul>

              <div>
                <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-faint">
                  <Scale size={11} /> what made this defect the driver
                </p>
                <ul className="space-y-0.5">
                  {g.terms.map((t) => (
                    <li key={t.name} className="flex items-center gap-2 text-[11px]">
                      <span className="w-40 shrink-0 truncate text-dim">{t.name}</span>
                      <Bar v={t.value} max={maxTerm} tone={t.value >= 0 ? "bg-amber-400/80" : "bg-sky-400/70"} />
                      <span className="tabular ml-auto w-10 shrink-0 text-right font-mono text-[10px] text-faint">
                        {t.value > 0 ? "+" : ""}
                        {Math.round(t.value)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[10px] text-faint">
                  driver: <span className="text-dim">{g.drivingDefect.title}</span> · score {g.drivingDefect.score} · 72 h risk{" "}
                  {(g.drivingDefect.risk * 100).toFixed(0)}%
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-edge bg-hull px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-faint">slot taken</p>
                  <p className="font-mono text-[11px] text-ink">
                    {fmtMin(g.chosen.startMin)}–{fmtMin(g.chosen.endMin)}
                  </p>
                  <p className="text-[10px] text-dim">
                    {g.chosen.window} · {Math.round(g.chosen.delayCostMin)} train-min · ~{g.chosen.affectedTrains} trains
                  </p>
                </div>
                <div className="rounded-lg border border-edge bg-hull px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-faint">best slot rejected</p>
                  <p className="font-mono text-[11px] text-ink">{g.runnerUp?.label ?? "—"}</p>
                  <p className="text-[10px] text-dim">
                    {g.runnerUp
                  ? g.runnerUp.penaltyVsChosen >= 1
                    ? `+${Math.round(g.runnerUp.penaltyVsChosen)} on the objective — it lost`
                    : `tied on the objective; the golden window is preferred`
                  : "nothing else was feasible"}
                  </p>
                </div>
                <div className="rounded-lg border border-edge bg-hull px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-faint">that night&apos;s budget</p>
                  <p className="font-mono text-[11px] text-ink">
                    {g.budget.usedMin}/{g.budget.limitMin} min
                  </p>
                  <p className="text-[10px] text-dim">{Math.max(0, g.budget.limitMin - g.budget.usedMin)} min left for tomorrow&apos;s emergency</p>
                </div>
              </div>

              {moved && (
                <p className="text-[10px] leading-relaxed text-amber-300/90">
                  as placed: D+{g.chosen.day} {fmtMin(g.chosen.startMin)}–{fmtMin(g.chosen.endMin)} · now: D+{current.now.day}{" "}
                  {current.now.clock}. The reasoning above still describes the slot the solver chose; the delay figure beside
                  the bar ({Math.round(current.now.delayCostMin)} train-min) is what the current slot costs.
                </p>
              )}
            </>
          ) : (
            <p className="text-[11px] text-faint">
              This block predates the explainability columns (or was created by hand), so no audit note was stored — the
              compliance verdict on the right is computed from the row as it stands.
            </p>
          )}

          {g && g.bundling.savedMin > 0 && (
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-dim">
              <Layers size={12} className="mt-0.5 shrink-0 text-emerald-400" />
              <span>
                {g.bundling.departments.join(" + ")} booked together: {g.bundling.separateBlockMin} min of separate
                occupations compressed into {g.bundling.bundledBlockMin} — <span className="text-emerald-400">{g.bundling.savedMin} min of line
                occupation returned to traffic</span>.
              </span>
            </p>
          )}

          <div className="flex flex-wrap gap-1.5">
            {current.defects.map((d) => (
              <span key={d.id} className="rounded border border-edge bg-hull px-1.5 py-0.5 text-[10px] text-dim" title={d.title}>
                <span className="font-mono text-faint">#{d.id}</span> {d.title.slice(0, 34)}
                {d.title.length > 34 ? "…" : ""}
                <span className="ml-1 text-amber-400">{d.severity}</span>
                <span className="ml-1 text-faint">{d.durationMin}m</span>
              </span>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-faint">
            <Clock size={11} /> rule book for this block · score {current.compliance?.score ?? 100}
          </p>
          <ul className="space-y-1">
            {(current.compliance?.results ?? []).map((r) => (
              <li key={r.id} className="flex items-start gap-2 text-[11px] leading-snug">
                {r.ok ? (
                  <Check size={12} className="mt-0.5 shrink-0 text-emerald-400" />
                ) : (
                  <X size={12} className={`mt-0.5 shrink-0 ${r.severity === "hard" ? "text-rose-400" : "text-amber-400"}`} />
                )}
                <span className={r.ok ? "text-faint" : "text-ink"}>
                  <span className="font-mono text-[10px] text-faint">{r.id}</span> {r.label}
                  {!r.ok && <span className="block text-[10px] text-rose-300">{r.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
          {current.compliance?.overrideReason && (
            <p className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300">
              approved over this breach by DRM: “{current.compliance.overrideReason}”
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
