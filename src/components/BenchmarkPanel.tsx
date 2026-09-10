"use client";

import { useEffect, useState } from "react";
import { ChevronDown, FlaskConical, Info, Loader2, RefreshCw } from "lucide-react";
import { COST } from "@/lib/engine/network";

/** Mirrors the engine's report shape (kept local: this panel must survive an engine type change). */
interface Outcome {
  blocks: number;
  occupations: number;
  downtimeMin: number;
  delayTrainMin: number;
  avgDelayMin: number;
  clearedItems: number;
  deferredItems: number;
  blockMinPerCleared: number;
  coveragePct: number;
  superBlocks: number;
  crewNights: number;
  arbitrations: number;
  conflicts: number;
  rupees: number;
}
interface Delta {
  mean: number;
  unit: string;
  ci95: [number, number];
  favour: string;
}
interface Report {
  ranAt: string;
  horizon: string;
  days: number;
  runs: number;
  seed: number;
  candidates: number;
  sections: number;
  ai: Outcome;
  manual: Outcome;
  winRatePct: number;
  efficiencyWinRatePct: number;
  deltas: Record<string, Delta>;
  assumptions: string[];
  perRun: { seed: number; manualDowntimeMin: number; aiDowntimeMin: number; manualCleared: number; aiCleared: number; manualArbitrations: number }[];
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** One metric, both planners, bars on the same scale. Lower is better unless `higherIsBetter`. */
function Compare({
  label,
  ai,
  manual,
  unit,
  higherIsBetter,
  digits = 0,
}: {
  label: string;
  ai: number;
  manual: number;
  unit: string;
  higherIsBetter?: boolean;
  digits?: number;
}) {
  const max = Math.max(ai, manual, 1);
  const aiWins = higherIsBetter ? ai >= manual : ai <= manual;
  const pct = (v: number) => Math.max(3, Math.round((v / max) * 100));
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-wider text-slate-400">{label}</span>
        <span className="text-[11px] text-slate-500">per {unit}</span>
      </div>
      <div className="space-y-1">
        {[
          { name: "RAIL RAKSHAK", v: ai, cls: aiWins ? "bg-emerald-500/80" : "bg-amber-500/70" },
          { name: "Simulated manual meeting", v: manual, cls: aiWins ? "bg-slate-600" : "bg-sky-500/70" },
        ].map((r) => (
          <div key={r.name} className="flex items-center gap-2">
            <span className="w-40 shrink-0 truncate text-[11px] text-slate-400">{r.name}</span>
            <div className="h-3 flex-1 overflow-hidden rounded-sm bg-slate-800/60">
              <div className={`h-full ${r.cls} rounded-sm`} style={{ width: `${pct(r.v)}%` }} />
            </div>
            <span className="tabular w-20 shrink-0 text-right font-mono text-[12px] text-slate-200">
              {r.v.toFixed(digits)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function BenchmarkPanel() {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState(100);
  const [seed, setSeed] = useState(1);
  const [open, setOpen] = useState(false);

  // setState is called from inside the .then() chain, never synchronously in the effect body —
  // this repo lints `react-hooks/set-state-in-effect`, and the async shape is also what avoids a
  // water/shell mismatch on the server-rendered panel.
  useEffect(() => {
    fetch("/api/benchmark", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { report?: Report } | null) => {
        if (d?.report) setReport(d.report);
      })
      .catch(() => undefined);
  }, []);

  async function rerun() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/benchmark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runs, seed }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else setReport(data.report);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const d = report?.deltas;

  return (
    <section className="panel overflow-hidden">
      <div className="panel-hd">
        <span className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-emerald-400" />
          <span className="text-[12px] font-semibold uppercase tracking-[0.18em] text-slate-200">
            Evidence · AI plan vs divisional meeting
          </span>
        </span>
        <span className="ml-auto flex items-center gap-2">
          <select
            value={runs}
            onChange={(e) => setRuns(Number(e.target.value))}
            className="rounded border border-slate-700 bg-slate-900/60 px-1.5 py-0.5 font-mono text-[11px] text-slate-300"
            title="How many meetings to simulate"
          >
            {[25, 50, 100, 200, 400].map((n) => (
              <option key={n} value={n}>
                {n} runs
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-[11px] text-slate-500">
            seed
            <input
              type="number"
              value={seed}
              min={1}
              max={9999}
              onChange={(e) => setSeed(Math.max(1, Number(e.target.value) || 1))}
              className="w-14 rounded border border-slate-700 bg-slate-900/60 px-1 py-0.5 font-mono text-[11px] text-slate-300"
            />
          </label>
          <button
            onClick={rerun}
            disabled={busy}
            className="flex items-center gap-1.5 rounded border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-[11px] font-semibold text-slate-200 transition-colors hover:border-emerald-500/60 hover:text-emerald-300 disabled:opacity-50"
            title="Re-runs the whole comparison; deterministic for a given seed"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Run
          </button>
        </span>
      </div>

      <div className="p-4">
        {!report && !busy && (
          <p className="text-[12px] text-slate-400">
            No benchmark stored yet. Press <span className="font-mono text-slate-200">Run</span> to simulate{" "}
            {runs} divisional allocation meetings against the generated plan for the same backlog.
          </p>
        )}
        {busy && !report && <p className="text-[12px] text-slate-400">Simulating {runs} meetings…</p>}
        {error && <p className="text-[12px] text-rose-300">Benchmark failed: {error}</p>}

        {report && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
              <span className="rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-emerald-300">
                AI at least as good on every metric in {report.winRatePct}% of {report.runs} meetings
              </span>
              <span className="rounded bg-slate-700/40 px-2 py-0.5 font-mono">
                efficiency win rate {report.efficiencyWinRatePct}%
              </span>
              <span>
                same backlog: {report.candidates} defects · {report.sections} sections · {report.days}-day cycle ·
                seed {report.seed}
              </span>
              <span className="ml-auto font-mono text-[10px] text-slate-500">
                ran {new Date(report.ranAt).toLocaleString("en-IN")}
              </span>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Compare
                label="Line occupation per defect cleared"
                ai={report.ai.blockMinPerCleared}
                manual={report.manual.blockMinPerCleared}
                unit="min/defect"
                digits={1}
              />
              <Compare
                label="Delay inflicted on running trains"
                ai={report.ai.delayTrainMin}
                manual={report.manual.delayTrainMin}
                unit="train-minutes"
                digits={0}
              />
              <Compare
                label="Backlog actually cleared this cycle"
                ai={report.ai.clearedItems}
                manual={report.manual.clearedItems}
                unit="defects (higher better)"
                higherIsBetter
              />
              <Compare
                label="Sections receiving attention"
                ai={report.ai.coveragePct}
                manual={report.manual.coveragePct}
                unit="% of grid (higher better)"
                higherIsBetter
              />
              <Compare
                label="Separate occupations to sanction"
                ai={report.ai.occupations}
                manual={report.manual.occupations}
                unit="approvals"
              />
              <Compare
                label="Gang-nights consumed"
                ai={report.ai.crewNights}
                manual={report.manual.crewNights}
                unit="dept-nights"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px] md:grid-cols-3">
              {d &&
                Object.entries(d).map(([k, v]) => (
                  <div key={k} className="rounded border border-slate-800 bg-slate-900/40 px-2 py-1.5">
                    <span className="text-slate-500">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
                    <div className="tabular font-mono text-slate-200">
                      {v.mean > 0 ? "+" : ""}
                      {v.mean} <span className="text-slate-500">{v.unit}</span>
                    </div>
                    <div className="font-mono text-[10px] text-slate-500">
                      95% CI [{v.ci95[0]}, {v.ci95[1]}] · {v.favour === "ai" ? "manual worse" : v.favour === "manual" ? "manual better" : "no difference"}
                    </div>
                  </div>
                ))}
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded border border-slate-800 bg-slate-900/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Avoidable delay costed</div>
                <div className="tabular font-mono text-lg text-emerald-300">
                  {inr(Math.max(0, report.manual.delayTrainMin - report.ai.delayTrainMin) * COST.paxDelayPerMin)}
                </div>
                <div className="text-[11px] text-slate-500">
                  per {report.days}-day cycle · {(COST.paxDelayPerMin).toLocaleString("en-IN")} ₹/train-minute · the
                  gap above, not the whole ₹{inr(report.manual.rupees)} of a manual cycle
                </div>
              </div>
              <div className="rounded border border-slate-800 bg-slate-900/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Left open by the meeting</div>
                <div className="tabular font-mono text-lg text-amber-300">
                  {Math.max(0, report.manual.deferredItems - report.ai.deferredItems)} defects
                </div>
                <div className="text-[11px] text-slate-500">
                  carried into the next cycle purely because the night budget went on duplicate occupations
                </div>
              </div>
              <div className="rounded border border-slate-800 bg-slate-900/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Manual arbitration load</div>
                <div className="tabular font-mono text-lg text-sky-300">
                  {report.manual.arbitrations.toFixed(0)} pushes
                </div>
                <div className="text-[11px] text-slate-500">
                  double-bookings the COA had to resolve by hand; {report.ai.conflicts} in the generated plan
                </div>
              </div>
            </div>

            <div>
              <button
                onClick={() => setOpen((o) => !o)}
                className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-slate-400 hover:text-slate-200"
              >
                <Info className="h-3.5 w-3.5" />
                Method &amp; assumptions
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
              </button>
              {open && (
                <ul className="mt-2 space-y-1 border-l border-slate-800 pl-3 text-[11px] leading-relaxed text-slate-400">
                  {report.assumptions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
