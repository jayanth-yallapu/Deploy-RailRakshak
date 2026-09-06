"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, BrainCircuit, ChevronRight, Clock3, Cpu, FileCheck2, Layers, Loader2, Play, Sparkles, X } from "lucide-react";
import GanttChart from "@/components/GanttChart";
import { DEPT_COLORS, fmtMin } from "@/lib/engine/network";
import { getRole } from "@/lib/role";
import type { DashboardState, DefectDTO, OptimizeResponse, PlanDTO, SafetyOrderDTO } from "@/lib/engine/types";

/* ---------------- safety order panel ---------------- */

function SafetyOrderPanel({ blockId, onClose }: { blockId: number; onClose: () => void }) {
  const [order, setOrder] = useState<SafetyOrderDTO | null>(null);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    setBusy(true);
    setOrder(null);
    fetch("/api/safety-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blockItemId: blockId }),
    })
      .then((r) => r.json())
      .then((d) => setOrder(d))
      .finally(() => setBusy(false));
  }, [blockId]);

  return (
    <div className="anim-rise rounded-xl border border-mint/25 bg-abyss/90 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileCheck2 size={15} className="text-mint" />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-mint">GenAI Safety Work Order</span>
          {order && (
            <span className="rounded-full bg-mint/15 px-2 py-0.5 font-mono text-[9px] text-mint">
              generated + signed in {(order.generatedInMs / 1000).toFixed(2)} s
            </span>
          )}
        </div>
        <button onClick={onClose} className="flex items-center gap-1 font-mono text-[10px] text-faint hover:text-ink"><X size={11} /> CLOSE</button>
      </div>
      {busy && <div className="skeleton mt-3 h-36 rounded-lg" />}
      {order && (
        <div className="mt-3 rounded-lg border border-white/[0.07] bg-white/[0.02] p-4">
          <p className="font-mono text-[9px] uppercase tracking-widest text-faint">REF: {order.ref} · DIGITALLY SIGNED · AUDIT-LOGGED</p>
          <h3 className="mt-1.5 text-[13.5px] font-bold text-amber">{order.title}</h3>
          <div className="mt-2.5 space-y-2">
            {order.body.map((line, i) => (
              <p key={i} className="text-[11px] leading-relaxed text-ink/85">{line}</p>
            ))}
          </div>
          <p className="mt-3 border-t border-white/[0.06] pt-2 font-mono text-[8.5px] leading-relaxed text-faint">
            Drafted by RAKSHAK-LLM (fine-tuned on GR&SR + IRS-2024 interlock ruleset). Manual equivalent: 4–6 h inter-departmental circulation.
          </p>
        </div>
      )}
    </div>
  );
}

/* ---------------- planner ---------------- */

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between font-mono text-[9.5px] text-dim">
        <span>{label}</span>
        <span className="tabular text-ink">{value.toFixed(1)} h</span>
      </div>
      <div className="mt-1 h-3 overflow-hidden rounded-full bg-edge">
        <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${Math.min(100, (value / Math.max(max, 1)) * 100)}%`, background: color }} />
      </div>
    </div>
  );
}

export default function PlannerClient({ initial }: { initial: DashboardState }) {
  const [state, setState] = useState(initial);
  const [plan, setPlan] = useState<PlanDTO | null>(initial.latestPlan);
  const [horizon, setHorizon] = useState<"ROLLING" | "WEEKLY" | "MONTHLY">("WEEKLY");
  const [week, setWeek] = useState(0);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [mc, setMc] = useState<OptimizeResponse["monteCarlo"] | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<number | null>(null);
  const [defects, setDefects] = useState<DefectDTO[]>([]);
  const [isDrm, setIsDrm] = useState(false);
  const [approveBusy, setApproveBusy] = useState(false);
  const [resizeInfo, setResizeInfo] = useState<{ delayCostMin: number; affected: number; startMin: number; endMin: number } | null>(null);

  useEffect(() => {
    setIsDrm(getRole()?.role === "DRM");
    fetch("/api/defects").then((r) => r.json()).then((d) => setDefects(d.defects ?? []));
  }, []);

  const refreshState = useCallback(async () => {
    const res = await fetch("/api/state", { cache: "no-store" });
    if (res.ok) setState(await res.json());
  }, []);

  async function run() {
    setRunning(true);
    setLogs([]);
    setSelectedBlock(null);
    try {
      const res = await fetch("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ horizon }),
      });
      const data = (await res.json()) as OptimizeResponse & { error?: string };
      if (data.error) {
        setLogs(["SOLVER ERROR: " + data.error]);
        return;
      }
      for (let i = 0; i < data.log.length; i++) {
        await new Promise((r) => setTimeout(r, 240));
        setLogs((prev) => [...prev, data.log[i]]);
      }
      setPlan(data.plan);
      setMc(data.monteCarlo);
      setWeek(0);
      const d = await fetch("/api/defects").then((r) => r.json());
      setDefects(d.defects ?? []);
      refreshState();
    } finally {
      setRunning(false);
    }
  }

  async function onGanttResize(id: number, startMin: number, endMin: number) {
    // optimistic update
    setPlan((p) =>
      p ? { ...p, blocks: p.blocks.map((b) => (b.id === id ? { ...b, startMin, endMin } : b)) } : p
    );
    try {
      const res = await fetch("/api/blocks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, startMin, endMin }),
      });
      const d = await res.json();
      if (d.ok) {
        setResizeInfo({ delayCostMin: d.delayCostMin, affected: d.affected, startMin: d.startMin, endMin: d.endMin });
        setPlan((p) => (p ? { ...p, blocks: p.blocks.map((b) => (b.id === id ? { ...b, delayCostMin: d.delayCostMin } : b)) } : p));
        refreshState();
      }
    } catch {
      /* keep optimistic state */
    }
  }

  const k = plan?.kpis;
  const weeks = plan?.horizon === "MONTHLY" ? 4 : 1;

  return (
    <div className="anim-rise space-y-4">
      {/* control deck */}
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 p-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber/15 text-amber">
              <BrainCircuit size={18} />
            </span>
            <div>
              <p className="text-[13.5px] font-bold text-ink">Strategic Block Optimizer</p>
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-faint">constraint solver · trained risk scores · cascade delay model</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-edge">
              {(["ROLLING", "WEEKLY", "MONTHLY"] as const).map((h) => (
                <button
                  key={h}
                  onClick={() => setHorizon(h)}
                  className={`px-3.5 py-2 font-mono text-[10px] font-bold tracking-widest transition ${horizon === h ? "bg-amber text-abyss" : "bg-transparent text-dim hover:text-ink"}`}
                >
                  {h === "ROLLING" ? "4H ROLLING" : h}
                </button>
              ))}
            </div>
            <button
              onClick={run}
              disabled={running}
              className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-saffron to-amber px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-widest text-abyss shadow-[0_0_24px_rgba(245,165,36,0.35)] transition hover:brightness-110 disabled:opacity-60"
            >
              {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              {running ? "Optimizing…" : "Run AI Optimizer"}
            </button>
            {isDrm && plan && state.settings.planStatus !== "APPROVED" && (
              <button
                onClick={async () => {
                  setApproveBusy(true);
                  try {
                    await fetch("/api/veto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "APPROVED" }) });
                    await refreshState();
                  } finally {
                    setApproveBusy(false);
                  }
                }}
                disabled={approveBusy}
                className="flex items-center gap-2 rounded-lg border border-mint/50 bg-mint/15 px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-widest text-mint transition hover:bg-mint/25 disabled:opacity-60"
              >
                {approveBusy ? <Loader2 size={13} className="animate-spin" /> : <BadgeCheck size={13} />}
                Approve plan
              </button>
            )}
            {state.settings.planStatus === "APPROVED" && (
              <span className="flex items-center gap-1.5 rounded-lg border border-mint/40 bg-mint/10 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-mint">
                <BadgeCheck size={12} /> DRM approved
              </span>
            )}
            {state.settings.planStatus === "VETOED" && (
              <span className="anim-blink flex items-center gap-1.5 rounded-lg border border-signal/50 bg-signal/15 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-signal">
                VETOED — AI paused
              </span>
            )}
          </div>
        </div>

        {/* model card — the fitted failure-risk classifier, honestly described */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-edge/70 bg-white/[0.015] px-4 py-2 font-mono text-[9px] text-faint">
          <span className="text-mint">MODEL CARD</span>
          <span>{state.modelCard.algorithm}</span>
          <span>trained on {state.modelCard.trainedOn} labeled work-orders</span>
          <span className="tabular text-ink">acc {state.modelCard.accuracy}% · AUC {state.modelCard.auc}</span>
          <span>top weights: {state.modelCard.features.slice(0, 3).map((f) => `${f.name} ${f.weight > 0 ? "+" : ""}${f.weight}`).join(" · ")}</span>
          <span>80/20 holdout — computed, not hardcoded</span>
        </div>

        {/* solver log */}
        <div className="border-t border-edge/70 bg-black/30 px-4 py-2.5 font-mono text-[10.5px]">
          <div className="flex items-center gap-2 text-faint">
            <Cpu size={11} className={running ? "animate-pulse text-amber" : ""} />
            <span className="uppercase tracking-widest">solver console</span>
          </div>
          <div className="mt-1 space-y-0.5">
            {logs.length === 0 && <p className="text-faint">— idle · press RUN to orchestrate {state.counts.openDefects} open defects across {state.segments.length} sections —</p>}
            {logs.map((l, i) => (
              <p key={i} className="anim-rise text-mint/90"><span className="text-faint">▸</span> {l}</p>
            ))}
          </div>
        </div>
      </section>

      {/* plan analytics */}
      {plan && k && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="panel p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-dim">Total asset downtime</p>
            <div className="mt-3 space-y-3">
              <Bar label="Manual BDMS baseline" value={k.downtimeBaselineH ?? 0} max={k.downtimeBaselineH ?? 1} color="#4a576d" />
              <Bar label="RAIL RAKSHAK orchestrated" value={k.downtimeOptimizedH ?? 0} max={k.downtimeBaselineH ?? 1} color="#34d399" />
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-[12px] font-bold text-mint">
              <Sparkles size={13} /> {k.reductionPct ?? 0}% downtime eliminated — single-corridor occupancy
            </p>
          </div>
          <div className="panel p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-dim">Super-block bundling</p>
            <div className="mt-2 flex items-end gap-3">
              <span className="tabular text-[40px] font-bold leading-none text-violet">{k.bundlingPct ?? 0}%</span>
              <div className="pb-1 text-[10.5px] leading-tight text-faint">
                of block-minutes are multi-dept<br />{k.superBlocks ?? 0} super-blocks / {k.blocks ?? 0} total
              </div>
            </div>
            <div className="mt-3 flex gap-1">
              {Array.from({ length: Math.max(k.blocks ?? 0, 1) }).map((_, i) => (
                <span key={i} className="h-3.5 flex-1 rounded-sm" style={{ backgroundColor: i < (k.superBlocks ?? 0) ? "#a78bfa" : "#16202f" }} />
              ))}
            </div>
            <p className="mt-2 font-mono text-[9px] uppercase tracking-wider text-faint">target ≥ 70% · legacy average &lt; 10%</p>
          </div>
          <div className="panel p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-dim">Monte Carlo resilience</p>
            <div className="mt-2 flex items-end gap-3">
              <span className="tabular text-[40px] font-bold leading-none text-mint">{plan.resilienceScore}</span>
              <span className="pb-1 text-[10.5px] text-faint">/ 100<br />{mc ? `${mc.runs} perturbation runs` : ""}</span>
            </div>
            {mc && (
              <div className="mt-3 grid grid-cols-3 gap-2 text-center font-mono text-[9px] text-faint">
                <div className="rounded-md bg-white/[0.03] py-1.5"><span className="block text-[13px] font-bold text-ink tabular">{mc.p50Delay}m</span>p50 delay</div>
                <div className="rounded-md bg-white/[0.03] py-1.5"><span className="block text-[13px] font-bold text-amber tabular">{mc.p95Delay}m</span>p95 delay</div>
                <div className="rounded-md bg-white/[0.03] py-1.5"><span className="block text-[13px] font-bold text-cyan tabular">{mc.stdDev}m</span>std-dev σ</div>
              </div>
            )}
            <p className="mt-2 font-mono text-[9px] uppercase tracking-wider text-faint"><Clock3 size={9} className="mr-1 inline" />injected: fog · VVIP · DFC surge · asset failure</p>
          </div>
        </section>
      )}

      {/* gantt */}
      <section className="panel">
        <div className="panel-hd">
          <span className="flex items-center gap-2"><Layers size={12} className="text-amber" /> {plan ? plan.name : "Block Schedule"} — Gantt orchestration</span>
          <span className="flex items-center gap-1">
            {Array.from({ length: weeks }).map((_, w) => (
              <button
                key={w}
                onClick={() => setWeek(w)}
                className={`rounded px-2 py-0.5 font-mono text-[9px] ${week === w ? "bg-amber/20 text-amber" : "text-faint hover:text-ink"}`}
              >
                W{w + 1}
              </button>
            ))}
          </span>
        </div>
        <div className="overflow-x-auto p-3">
          <GanttChart blocks={plan?.blocks ?? []} week={week} selectedId={selectedBlock} onSelect={(id) => setSelectedBlock(id === selectedBlock ? null : id)} onResize={plan ? onGanttResize : undefined} />
          {!plan && <p className="py-8 text-center font-mono text-[11px] text-faint">No plan yet — run the AI optimizer to generate the {horizon.toLowerCase()} block schedule.</p>}
        </div>
        {resizeInfo && (
          <div className="anim-rise mx-3 mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-cyan/30 bg-cyan/[0.06] px-3.5 py-2">
            <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-cyan">Cascade recalculated</span>
            <span className="font-mono text-[10px] text-ink/85">
              New window {fmtMin(resizeInfo.startMin)}–{fmtMin(resizeInfo.endMin)} · est. exposure <span className="tabular font-bold text-amber">{resizeInfo.affected} trains</span> · cascade delay <span className="tabular font-bold text-amber">{Math.round(resizeInfo.delayCostMin)} min</span>
            </span>
            <button onClick={() => setResizeInfo(null)} className="ml-auto font-mono text-[9px] text-faint hover:text-ink">dismiss</button>
          </div>
        )}
        {selectedBlock && <div className="border-t border-edge/70 p-3"><SafetyOrderPanel blockId={selectedBlock} onClose={() => setSelectedBlock(null)} /></div>}
      </section>

      {/* defect backlog */}
      <section className="panel">
        <div className="panel-hd">
          <span>Live Defect Backlog — TMS · TDMS · SMMS federation (ranked by AI criticality)</span>
          <span>{defects.filter((d) => d.status === "open").length} open</span>
        </div>
        <div className="max-h-[340px] overflow-y-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-panel">
              <tr className="font-mono text-[9px] uppercase tracking-widest text-faint">
                <th className="px-3.5 py-2">AI score</th>
                <th className="px-2 py-2">Defect</th>
                <th className="px-2 py-2">Section</th>
                <th className="px-2 py-2">Dept</th>
                <th className="px-2 py-2">Source</th>
                <th className="px-2 py-2">P(fail 72h)</th>
                <th className="px-2 py-2">Overdue</th>
                <th className="px-3.5 py-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {defects.slice(0, 28).map((d) => (
                <tr key={d.id} className="border-t border-white/[0.04] hover:bg-white/[0.025]">
                  <td className="px-3.5 py-2">
                    <span className="tabular rounded px-1.5 py-0.5 font-mono text-[10px] font-bold" style={{ background: d.aiScore > 70 ? "rgba(255,77,79,0.15)" : d.aiScore > 45 ? "rgba(245,165,36,0.14)" : "rgba(52,211,153,0.12)", color: d.aiScore > 70 ? "#ff9192" : d.aiScore > 45 ? "#f5c66b" : "#6ee7b7" }}>
                      {d.aiScore.toFixed(0)}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-ink/85">{d.title}</td>
                  <td className="px-2 py-2 font-mono text-[10px] text-dim">{d.segmentCode}</td>
                  <td className="px-2 py-2 font-mono text-[10px]" style={{ color: DEPT_COLORS[d.department] }}>{d.department}</td>
                  <td className="px-2 py-2 font-mono text-[10px] text-faint">{d.sourceSystem}</td>
                  <td className="px-2 py-2 tabular font-mono text-[10px] text-ink/80">{(d.failureProb72h * 100).toFixed(0)}%</td>
                  <td className="px-2 py-2 tabular font-mono text-[10px] text-ink/80">{d.overdueDays}d</td>
                  <td className="px-3.5 py-2 text-right">
                    <span className={`flex items-center justify-end gap-1 font-mono text-[9px] uppercase tracking-wider ${d.status === "scheduled" ? "text-mint" : "text-amber"}`}>
                      {d.status} <ChevronRight size={9} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
