"use client";

import { useState } from "react";
import { AlertOctagon, CheckCircle2, Crosshair, Loader2, RefreshCcw, Route, ShieldCheck, Siren } from "lucide-react";
import type { CrisisResult, CrisisStep } from "@/lib/engine/types";

const TONE: Record<CrisisStep["tone"], { color: string; bg: string }> = {
  info: { color: "#38bdf8", bg: "rgba(56,189,248,0.08)" },
  warn: { color: "#f5a524", bg: "rgba(245,165,36,0.08)" },
  critical: { color: "#ff4d4f", bg: "rgba(255,77,79,0.1)" },
  ok: { color: "#34d399", bg: "rgba(52,211,153,0.08)" },
};

export default function CrisisConsole() {
  const [data, setData] = useState<CrisisResult | null>(null);
  const [visible, setVisible] = useState(0);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [resolvedWall, setResolvedWall] = useState(0);

  async function run() {
    setRunning(true);
    setData(null);
    setVisible(0);
    setResolvedWall(0);
    const t0 = performance.now();
    const tick = setInterval(() => setElapsed((performance.now() - t0) / 1000), 100);
    try {
      const res = await fetch("/api/crisis", { method: "POST" });
      const d = (await res.json()) as CrisisResult;
      setData(d);
      for (let i = 1; i <= d.steps.length; i++) {
        await new Promise((r) => setTimeout(r, i === 1 ? 250 : 620));
        setVisible(i);
      }
      setResolvedWall((performance.now() - t0) / 1000);
    } finally {
      clearInterval(tick);
      setRunning(false);
    }
  }

  const done = !!(data && visible >= data.steps.length);
  const lakh = (n: number) => `₹${(n / 100000).toFixed(1)}L`;

  return (
    <section className="panel overflow-hidden border-signal/20">
      <div className="relative border-b border-signal/25 bg-gradient-to-r from-signal/[0.09] via-transparent to-transparent px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-signal/15 text-signal">
            <Siren size={20} className={running ? "animate-pulse" : ""} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-bold tracking-wide text-ink">FINAL BOSS PROTOCOL — multi-crisis autonomous resolution</p>
            <p className="mt-0.5 max-w-3xl truncate font-mono text-[9.5px] uppercase tracking-wider text-faint" title="fog, vip, fracture, freight, rrts, dtp">
              fog 35 m × VVIP T-2h × bridge fracture × 10,200 T DFC rake × RRTS peak × DTP red-zone
            </p>
          </div>
          {(running || done) && (
            <div className={`flex shrink-0 flex-col items-end rounded-lg border px-3 py-1.5 ${done ? "border-mint/50 bg-mint/10" : "border-signal/50 bg-signal/10"}`}>
              {done ? (
                <>
                  <span className="tabular font-mono text-[15px] font-bold text-mint">{(resolvedWall || 0).toFixed(1)}s</span>
                  <span className="font-mono text-[7.5px] uppercase tracking-widest text-mint">RESOLVED — of 60s budget</span>
                </>
              ) : (
                <>
                  <span className="tabular anim-pulse font-mono text-[15px] font-bold text-signal">{Math.max(0, 60 - elapsed).toFixed(1)}s</span>
                  <span className="font-mono text-[7.5px] uppercase tracking-widest text-signal">countdown to failure</span>
                </>
              )}
            </div>
          )}
          <button
            onClick={run}
            disabled={running}
            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-signal to-[#ff7a45] px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-widest text-abyss shadow-[0_0_28px_rgba(255,77,79,0.4)] transition hover:brightness-110 disabled:opacity-60"
          >
            {running ? <Loader2 size={13} className="animate-spin" /> : data ? <RefreshCcw size={13} /> : <Crosshair size={13} />}
            {running ? "Resolving…" : data ? "Re-run scenario" : "Initiate"}
          </button>
        </div>
      </div>

      {!data && !running && (
        <div className="gridlines px-6 py-10 text-center">
          <AlertOctagon size={30} className="mx-auto text-signal/70" />
          <p className="mx-auto mt-3 max-w-xl text-[12.5px] leading-relaxed text-dim">
            The problem that has defeated every legacy system: a foggy Delhi morning, a VVIP special with 2 hours notice,
            an ITMS critical rail fracture on Yamuna Bridge #2 (NZM–ANVT), a 10,200-tonne DFC rake bearing down from Ghaziabad,
            Namo Bharat RRTS at peak and DTP red-zone at every level crossing. <span className="text-ink">Press INITIATE — the AI resolves it in under 60 seconds.</span>
          </p>
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 gap-0 lg:grid-cols-5">
          {/* timeline */}
          <div className="border-b border-edge/60 bg-black/25 p-4 lg:col-span-3 lg:border-b-0 lg:border-r">
            <div className="space-y-2">
              {data.steps.slice(0, visible).map((s, i) => (
                <div key={i} className="anim-rise flex gap-3 rounded-lg border p-2.5" style={{ borderColor: `${TONE[s.tone].color}33`, background: TONE[s.tone].bg }}>
                  <span className="mt-0.5 flex shrink-0 items-start gap-1 font-mono text-[9px] font-bold" style={{ color: TONE[s.tone].color }}>
                    <CheckCircle2 size={11} className="mt-px" />
                    <span className="tabular">T+{String(s.tSec).padStart(2, "0")}s</span>
                  </span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="rounded px-1.5 py-0.5 font-mono text-[8.5px] font-bold tracking-widest" style={{ background: `${TONE[s.tone].color}22`, color: TONE[s.tone].color }}>
                        {s.tag}
                      </span>
                      <span className="text-[12px] font-bold text-ink">{s.title}</span>
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-ink/75">{s.detail}</p>
                  </div>
                </div>
              ))}
              {!done && (
                <div className="flex items-center gap-2 p-2 font-mono text-[10px] text-faint">
                  <Loader2 size={11} className="animate-spin text-amber" /> agents negotiating…
                </div>
              )}
            </div>
          </div>

          {/* decision */}
          <div className="p-4 lg:col-span-2">
            {done ? (
              <div className="anim-rise space-y-3">
                <div className="rounded-xl border border-mint/30 bg-mint/[0.06] p-3.5">
                  <p className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-widest text-mint">
                    <ShieldCheck size={13} /> Crisis resolved in {data.resolvedInSec} s — zero cancellations
                  </p>
                  <p className="mt-2 text-[12px] font-semibold leading-snug text-ink">{data.decision.action}</p>
                </div>
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5 font-mono text-[10px]">
                  <div className="flex justify-between py-1 text-dim"><span className="flex items-center gap-1.5"><Route size={11} /> Reroute via</span><span className="text-ink">{data.decision.rerouteVia}</span></div>
                  <div className="flex justify-between py-1 text-dim"><span>Block duration</span><span className="tabular text-ink">{data.decision.blockMin} min</span></div>
                  <div className="flex justify-between py-1 text-dim"><span>DFC rakes held</span><span className="tabular text-amber">{data.decision.freightHeld} @ TKD yard</span></div>
                  <div className="flex justify-between py-1 text-dim"><span>Hold-all doctrine</span><span className="tabular text-signal">{lakh(data.decision.costHold)}</span></div>
                  <div className="flex justify-between py-1 text-dim"><span>AI reroute doctrine</span><span className="tabular text-cyan">{lakh(data.decision.costReroute)}</span></div>
                  <div className="mt-1 flex justify-between border-t border-white/[0.08] pt-2"><span className="uppercase tracking-widest text-faint">Net saving</span><span className="tabular text-[15px] font-bold text-mint">{lakh(data.decision.savings)}</span></div>
                </div>
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5">
                  <p className="font-mono text-[9px] uppercase tracking-widest text-faint">Machine justification (audit trail)</p>
                  <ul className="mt-2 space-y-1.5">
                    {data.decision.justification.map((j, i) => (
                      <li key={i} className="flex gap-2 text-[10.5px] leading-relaxed text-ink/80">
                        <CheckCircle2 size={11} className="mt-0.5 shrink-0 text-mint" /> {j}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[200px] flex-col items-center justify-center text-center">
                <div className="anim-spin-slow h-16 w-16 rounded-full border-2 border-dashed border-amber/50" />
                <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-faint">tactical planner scoring 6 candidate doctrines…</p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
