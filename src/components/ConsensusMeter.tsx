"use client";

import { useState } from "react";
import { Fingerprint, Loader2, Lock } from "lucide-react";
import { DEPT_COLORS } from "@/lib/engine/network";
import type { ConsensusResult, SegmentDTO } from "@/lib/engine/types";

export default function ConsensusMeter({ segments }: { segments: SegmentDTO[] }) {
  const [segmentId, setSegmentId] = useState<number>(segments.find((s) => s.code === "NZM-ANVT")?.id ?? segments[0]?.id ?? 1);
  const [data, setData] = useState<ConsensusResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function run(id: number) {
    setLoading(true);
    try {
      const res = await fetch("/api/consensus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segmentId: id }),
      });
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }

  const pct = data?.agreementPct ?? 0;
  const R = 52;
  const C = 2 * Math.PI * R;
  const color = !data ? "#334155" : data.decision === "APPROVED" ? "#34d399" : "#ff9933";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 pb-1">
        <select
          value={segmentId}
          onChange={(e) => {
            setSegmentId(Number(e.target.value));
            run(Number(e.target.value));
          }}
          className="w-full rounded-md border border-edge bg-hull px-2 py-1.5 font-mono text-[11px] text-ink outline-none"
        >
          {segments.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} · {s.corridor}
            </option>
          ))}
        </select>
        <button
          onClick={() => run(segmentId)}
          disabled={loading}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-mint/15 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-mint transition hover:bg-mint/25 disabled:opacity-50"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <Fingerprint size={12} />}
          Vote
        </button>
      </div>

      <div className="flex flex-1 items-center gap-4 px-4 py-2">
        <div className="relative h-[124px] w-[124px] shrink-0">
          <svg viewBox="0 0 124 124" className="h-full w-full -rotate-90">
            <circle cx="62" cy="62" r={R} fill="none" stroke="#141d2f" strokeWidth="9" />
            <circle
              cx="62"
              cy="62"
              r={R}
              fill="none"
              stroke={color}
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C - (C * pct) / 100}
              style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.2,0.9,0.3,1), stroke 0.4s" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="tabular text-2xl font-bold" style={{ color }}>
              {data ? `${pct}%` : "—"}
            </span>
            <span className="font-mono text-[8.5px] uppercase tracking-widest text-faint">agreement</span>
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          {(data?.votes ?? [
            { system: "TMS · FedAgent-01", dept: "ENG" as const, vote: 0, rationale: "" },
            { system: "TDMS · FedAgent-02", dept: "TRD" as const, vote: 0, rationale: "" },
            { system: "SMMS · FedAgent-03", dept: "SNT" as const, vote: 0, rationale: "" },
          ]).map((v) => (
            <div key={v.system}>
              <div className="flex items-center justify-between font-mono text-[9.5px] text-dim">
                <span className="flex items-center gap-1">
                  <Lock size={8} className="text-faint" />
                  {v.system}
                </span>
                <span className="tabular" style={{ color: DEPT_COLORS[v.dept] }}>
                  {v.vote || "—"}
                </span>
              </div>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-edge">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${v.vote}%`, background: DEPT_COLORS[v.dept] }}
                />
              </div>
            </div>
          ))}
          <p className="pt-1 font-mono text-[8.5px] uppercase tracking-wider text-faint">
            votes computed live from TMS/TDMS/SMMS section data · deterministic
          </p>
        </div>
      </div>

      {data && (
        <div className="mx-3 mb-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-widest text-faint">LLM root-cause</span>
            <span
              className="rounded-full px-2 py-0.5 font-mono text-[9px] font-bold"
              style={{
                background: data.decision === "APPROVED" ? "rgba(52,211,153,0.15)" : "rgba(255,153,51,0.15)",
                color: data.decision === "APPROVED" ? "#34d399" : "#ff9933",
              }}
            >
              {data.decision}
            </span>
          </div>
          <p className="text-[10.5px] leading-relaxed text-ink/80">{data.rootCause}</p>
        </div>
      )}
    </div>
  );
}
