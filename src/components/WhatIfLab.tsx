"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BadgeIndianRupee, Boxes, CheckCircle2, FlaskConical, Fuel, Loader2, TrafficCone, TrainFront, Users, XCircle } from "lucide-react";
import RailMap from "@/components/RailMap";
import { fmtMin } from "@/lib/engine/network";
import type { SegmentDTO, StationDTO, WhatIfResult } from "@/lib/engine/types";

const lakh = (n: number) => `₹${(n / 100000).toFixed(2)}L`;

export default function WhatIfLab({ stations, segments, fog }: { stations: StationDTO[]; segments: SegmentDTO[]; fog: boolean }) {
  const [segmentId, setSegmentId] = useState(segments.find((s) => s.code === "NZM-ANVT")?.id ?? segments[0]?.id ?? 1);
  const [durationH, setDurationH] = useState(2);
  const [startMin, setStartMin] = useState(600);
  const [superBlock, setSuperBlock] = useState(true);
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/whatif", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ segmentId, durationH, startMin, superBlock }),
        });
        setResult(await res.json());
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [segmentId, durationH, startMin, superBlock]);

  const seg = useMemo(() => segments.find((s) => s.id === segmentId), [segments, segmentId]);

  return (
    <section className="panel overflow-hidden">
      <div className="panel-hd">
        <span className="flex items-center gap-2"><FlaskConical size={12} className="text-cyan" /> What-If Cascade Lab — cascade delay propagation · ₹ cost-benefit engine</span>
        <span className="text-[9px]">{loading ? "COMPUTING…" : "LIVE"}</span>
      </div>
      <div className="grid grid-cols-1 gap-0 lg:grid-cols-5">
        {/* controls */}
        <div className="border-b border-edge/60 p-4 lg:col-span-2 lg:border-b-0 lg:border-r">
          <label className="font-mono text-[9px] uppercase tracking-widest text-faint">Block section</label>
          <select value={segmentId} onChange={(e) => setSegmentId(Number(e.target.value))} className="mt-1 w-full rounded-md border border-edge bg-hull px-2.5 py-2 font-mono text-[11px] text-ink outline-none">
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.corridor}{s.isBridge ? " · BRIDGE" : ""}
              </option>
            ))}
          </select>

          <div className="mt-4">
            <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-widest text-faint">
              <span>Block duration</span>
              <span className="tabular text-[12px] font-bold text-amber">{durationH} h</span>
            </div>
            <input type="range" min={1} max={8} step={0.5} value={durationH} onChange={(e) => setDurationH(Number(e.target.value))} className="mt-1.5 w-full accent-amber" />
            <div className="flex justify-between font-mono text-[8px] text-faint"><span>1h</span><span>4h</span><span>8h</span></div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-widest text-faint">
              <span>Start time</span>
              <span className="tabular text-[12px] font-bold text-cyan">{fmtMin(startMin)} IST</span>
            </div>
            <input type="range" min={0} max={1410} step={30} value={startMin} onChange={(e) => setStartMin(Number(e.target.value))} className="mt-1.5 w-full accent-cyan" />
            <div className="flex justify-between font-mono text-[8px] text-faint"><span>00:00</span><span>Golden 00:30–04:30</span><span>23:30</span></div>
          </div>

          <button
            onClick={() => setSuperBlock(!superBlock)}
            className={`mt-4 flex w-full items-center gap-2.5 rounded-lg border p-2.5 text-left transition ${superBlock ? "border-violet/40 bg-violet/10" : "border-edge bg-white/[0.02]"}`}
          >
            <Boxes size={16} className={superBlock ? "text-violet" : "text-faint"} />
            <span>
              <span className={`block text-[11.5px] font-bold ${superBlock ? "text-violet" : "text-dim"}`}>Super-block bundling {superBlock ? "ON" : "OFF"}</span>
              <span className="block font-mono text-[8.5px] uppercase tracking-wider text-faint">ENG+TRD+SNT simultaneous occupancy</span>
            </span>
          </button>

          {seg && (
            <div className="mt-4 grid grid-cols-3 gap-2 text-center font-mono text-[9px] text-faint">
              <div className="rounded-md bg-white/[0.03] py-2"><span className="tabular block text-[13px] font-bold text-ink">{seg.dailyTrains}</span>trains/day</div>
              <div className="rounded-md bg-white/[0.03] py-2"><span className="tabular block text-[13px] font-bold text-ink">{seg.criticality}/10</span>criticality</div>
              <div className="rounded-md bg-white/[0.03] py-2"><span className="tabular block text-[13px] font-bold text-ink">{seg.lengthKm}km</span>section</div>
            </div>
          )}
        </div>

        {/* map + verdict */}
        <div className="p-4 lg:col-span-3">
          <div className="gridlines overflow-hidden rounded-xl border border-edge/60">
            <RailMap
              stations={stations}
              segments={segments}
              heat={result?.stationHeat ?? {}}
              blockedSegmentIds={[segmentId]}
              fog={fog}
            />
          </div>

          {result && (
            <div className="anim-rise mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className={`rounded-xl border p-3.5 ${result.recommend ? "border-mint/30 bg-mint/[0.06]" : "border-signal/30 bg-signal/[0.06]"}`}>
                <div className="flex items-center gap-2">
                  {result.recommend ? <CheckCircle2 size={16} className="text-mint" /> : <XCircle size={16} className="text-signal" />}
                  <span className={`font-mono text-[11px] font-bold uppercase tracking-widest ${result.recommend ? "text-mint" : "text-signal"}`}>
                    {result.recommend ? "AI recommends block" : "AI rejects this window"}
                  </span>
                </div>
                <p className="mt-2 text-[11.5px] leading-relaxed text-ink/85">{result.verdict}</p>
                <p className="mt-2 font-mono text-[9px] uppercase tracking-wider text-faint">
                  best window instead: <span className="text-amber">{fmtMin(result.bestWindow.startMin)} IST</span>
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5">
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 font-mono text-[10px]">
                  <span className="flex items-center gap-1.5 text-dim"><TrainFront size={11} /> Trains hit</span><span className="tabular text-right font-bold text-ink">{result.affectedTrains}</span>
                  <span className="flex items-center gap-1.5 text-dim"><Fuel size={11} /> Delay minutes</span><span className="tabular text-right font-bold text-amber">{result.totalDelayMin}</span>
                  <span className="flex items-center gap-1.5 text-dim"><Users size={11} /> Pax delay cost</span><span className="tabular text-right text-signal">{lakh(result.passengerDelayCost)}</span>
                  <span className="flex items-center gap-1.5 text-dim"><TrafficCone size={11} /> DFC penalty</span><span className="tabular text-right text-signal">{lakh(result.freightPenalty)}</span>
                  <span className="flex items-center gap-1.5 text-dim"><BadgeIndianRupee size={11} /> Failure cost avoided</span><span className="tabular text-right text-mint">+{lakh(result.futureFailureCostAvoided)}</span>
                  <span className="flex items-center gap-1.5 text-dim"><Fuel size={11} /> Idle/shunt savings</span><span className="tabular text-right text-mint">+{lakh(result.dieselSavings)}</span>
                  <span className="col-span-2 mt-1 flex items-center justify-between border-t border-white/[0.07] pt-2 text-[11px]">
                    <span className="uppercase tracking-widest text-faint">Net benefit</span>
                    <span className={`tabular text-[15px] font-bold ${result.netBenefit >= 0 ? "text-mint" : "text-signal"}`}>{result.netBenefit >= 0 ? "+" : "−"}{lakh(Math.abs(result.netBenefit))}</span>
                  </span>
                </div>
                <div className="mt-2.5">
                  <div className="flex justify-between font-mono text-[8.5px] uppercase tracking-wider text-faint"><span>Human impact score</span><span className="tabular">{result.humanImpactScore}/100</span></div>
                  <div className="mt-1 h-1.5 rounded-full bg-edge"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${result.humanImpactScore}%`, background: result.humanImpactScore > 60 ? "#ff4d4f" : result.humanImpactScore > 30 ? "#f5a524" : "#34d399" }} /></div>
                </div>
              </div>
            </div>
          )}

          {result && result.cascade.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {result.cascade.map((c) => (
                <div key={c.station} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5">
                  <span className="font-mono text-[9px] uppercase tracking-wider text-faint">{c.station}</span>
                  <span className="tabular ml-2 text-[12px] font-bold text-amber">{c.delayMin}m</span>
                  <span className="ml-2 hidden text-[9.5px] text-dim sm:inline">{c.note}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
