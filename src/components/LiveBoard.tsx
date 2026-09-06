import { ArrowRight } from "lucide-react";
import { fmtMin } from "@/lib/engine/network";
import type { LiveTrainDTO } from "@/lib/engine/types";

const KIND_COLOR: Record<string, string> = {
  RAJDHANI: "#ff9f43",
  VANDE_BHARAT: "#7ee787",
  SHATABDI: "#34d399",
  EXPRESS: "#38bdf8",
  PASSENGER: "#c084fc",
  DFC_FREIGHT: "#f43f5e",
  RAPIDX: "#22d3ee",
};

export default function LiveBoard({ trains }: { trains: LiveTrainDTO[] }) {
  const sorted = [...trains].sort((a, b) => {
    const rank = (s: string) => (s === "RUNNING" ? 0 : s === "SCHEDULED" ? 1 : 2);
    return rank(a.status) - rank(b.status) || a.schDep - b.schDep;
  });

  return (
    <div className="max-h-[300px] overflow-y-auto">
      {sorted.length === 0 && (
        <p className="p-4 text-center font-mono text-[10px] text-faint">No trains in tracking window — off-peak hours</p>
      )}
      {sorted.map((t, i) => {
        const col = KIND_COLOR[t.kind] ?? "#94a3b8";
        return (
          <div key={t.number + i} className="flex items-center gap-2.5 border-b border-white/[0.04] px-3 py-2 hover:bg-white/[0.02]">
            <span className="tabular w-[52px] shrink-0 font-mono text-[11px] font-bold" style={{ color: col }}>
              {t.number}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-semibold text-ink/90">{t.name}</p>
              <p className="flex items-center gap-1 font-mono text-[8.5px] text-faint">
                {t.from} <ArrowRight size={8} /> {t.to} · SCH {fmtMin(t.schDep)}
              </p>
            </div>
            <div className="shrink-0 text-right">
              {t.status === "RUNNING" ? (
                <>
                  <p className="font-mono text-[9px] font-bold text-mint">@{t.segCode?.replace("XR:", "")} → {t.nextStation}</p>
                  <p className={`font-mono text-[8.5px] ${t.delayMin > 8 ? "text-signal" : "text-dim"}`}>
                    {t.delayMin === 0 ? "RIGHT TIME" : `+${t.delayMin}m`} · {t.progressPct}%
                  </p>
                </>
              ) : t.status === "SCHEDULED" ? (
                <p className="font-mono text-[9px] text-dim">YET TO START</p>
              ) : (
                <p className="font-mono text-[9px] text-faint">ARRIVED</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
