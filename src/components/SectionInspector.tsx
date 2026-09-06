"use client";

import { useEffect, useState } from "react";
import { LandPlot, MapPin, Milestone, RadioTower, TrafficCone } from "lucide-react";
import { CORRIDOR_COLORS, DEPT_COLORS, sectionMeta } from "@/lib/engine/network";
import type { DefectDTO, SegmentDTO } from "@/lib/engine/types";

export default function SectionInspector({ segment }: { segment: SegmentDTO | null }) {
  const [defects, setDefects] = useState<DefectDTO[]>([]);

  useEffect(() => {
    fetch("/api/defects")
      .then((r) => r.json())
      .then((d) => setDefects(d.defects ?? []));
  }, []);

  if (!segment) {
    return (
      <div className="flex h-full min-h-[220px] flex-col items-center justify-center p-6 text-center">
        <Milestone size={26} className="text-faint" />
        <p className="mt-3 max-w-[240px] text-[11.5px] leading-relaxed text-dim">
          Click any track section on the map to inspect its real chainage, jurisdiction, OHE depot and open defects.
        </p>
      </div>
    );
  }

  const meta = sectionMeta(segment.code);
  const color = CORRIDOR_COLORS[segment.corridor] ?? "#64748b";
  const segDefects = defects.filter((d) => d.segmentId === segment.id && d.status !== "closed");

  return (
    <div className="anim-rise space-y-3 p-3.5">
      <div>
        <div className="flex items-center gap-2">
          <span className="rounded px-2 py-0.5 font-mono text-[11px] font-bold" style={{ background: `${color}1f`, color }}>
            {segment.code}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-widest text-faint">{segment.corridor} corridor</span>
          {segment.isBridge && <span className="rounded bg-amber/15 px-1.5 py-0.5 font-mono text-[8.5px] font-bold text-amber">YAMUNA BRIDGE</span>}
        </div>
        <p className="mt-1.5 flex items-center gap-1.5 font-mono text-[9.5px] text-dim">
          <Milestone size={10} className="text-faint" /> {meta?.chainage}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px]">
        {[
          { icon: <LandPlot size={10} />, text: meta?.geom },
          { icon: <RadioTower size={10} />, text: meta?.signalling },
          { icon: <MapPin size={10} />, text: meta?.rail },
          { icon: <Milestone size={10} />, text: meta?.sleeper },
          { icon: <TrafficCone size={10} />, text: meta?.lcGates },
          { icon: <RadioTower size={10} />, text: meta?.ohe },
        ].map((row, i) => (
          <div key={i} className="flex items-start gap-1.5 text-dim">
            <span className="mt-0.5 shrink-0 text-faint">{row.icon}</span>
            <span className="leading-snug">{row.text}</span>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
        <p className="font-mono text-[8.5px] uppercase tracking-widest text-faint">Jurisdiction — {meta?.jurisdiction}</p>
        <p className="mt-0.5 font-mono text-[8.5px] text-faint">Restriction: {meta?.tsr}</p>
      </div>

      <div>
        <p className="font-mono text-[9px] uppercase tracking-widest text-faint">
          Open defects on section — <span className="text-amber">{segDefects.length}</span>
        </p>
        <div className="mt-1.5 max-h-[130px] space-y-1 overflow-y-auto pr-1">
          {segDefects.length === 0 && <p className="py-2 font-mono text-[9.5px] text-mint">Section clear — no open defects reported by TMS/TDMS/SMMS</p>}
          {segDefects.map((d) => (
            <div key={d.id} className="flex items-center gap-2 rounded-md bg-white/[0.03] px-2 py-1.5">
              <span className="tabular shrink-0 rounded px-1 font-mono text-[9px] font-bold" style={{ background: d.aiScore > 70 ? "rgba(255,77,79,0.16)" : "rgba(245,165,36,0.14)", color: d.aiScore > 70 ? "#ff9192" : "#f5c66b" }}>
                {d.aiScore.toFixed(0)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[10px] text-ink/85">{d.title}</span>
              <span className="shrink-0 font-mono text-[8.5px]" style={{ color: DEPT_COLORS[d.department] }}>{d.department}</span>
              <span className="shrink-0 font-mono text-[8.5px] text-faint">{d.sourceSystem}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
