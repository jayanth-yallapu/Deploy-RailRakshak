"use client";

import { useState } from "react";
import { Expand, X } from "lucide-react";
import type { EventDTO } from "@/lib/engine/types";

const PILL: Record<EventDTO["kind"], { label: string; color: string; bg: string }> = {
  info: { label: "INFO", color: "#38bdf8", bg: "rgba(56,189,248,0.12)" },
  warn: { label: "WARN", color: "#f5a524", bg: "rgba(245,165,36,0.12)" },
  critical: { label: "CRITICAL", color: "#ff4d4f", bg: "rgba(255,77,79,0.14)" },
  ai: { label: "RAKSHAK-CORE", color: "#d8b4fe", bg: "rgba(167,139,250,0.14)" },
};

function Row({ e }: { e: EventDTO }) {
  const p = PILL[e.kind] ?? PILL.info;
  return (
    <div className="grid grid-cols-[56px_auto_1fr] items-start gap-2 border-b border-white/[0.04] px-2.5 py-1.5 last:border-0 hover:bg-white/[0.02]">
      <span className="tabular pt-0.5 font-mono text-[8.5px] text-faint">
        {new Date(e.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
      </span>
      <span className="mt-px inline-block w-fit rounded-full px-1.5 py-px font-mono text-[7.5px] font-bold tracking-wider" style={{ color: p.color, background: p.bg }}>
        {p.label}
      </span>
      <span className="break-words text-[10.5px] leading-snug text-ink/85">{e.message}</span>
    </div>
  );
}

export default function LiveFeed({ events, expandable = true }: { events: EventDTO[]; expandable?: boolean }) {
  const [open, setOpen] = useState(false);
  const rows = [...events].reverse();

  return (
    <div className="flex h-full flex-col">
      <div className="h-[250px] overflow-y-auto">
        {rows.map((e) => <Row key={e.id} e={e} />)}
        {rows.length === 0 && <p className="p-4 text-center font-mono text-[10px] text-faint">No events yet</p>}
      </div>
      {expandable && (
        <div className="flex justify-end border-t border-white/[0.05] px-2 py-1.5">
          <button onClick={() => setOpen(true)} className="flex items-center gap-1 rounded-md border border-edge px-2 py-1 font-mono text-[8.5px] uppercase tracking-widest text-dim transition hover:text-ink">
            <Expand size={9} /> Expand logs
          </button>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-abyss/85 p-6 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="anim-rise flex h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-edge bg-hull" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-edge px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-dim">Event Spine — full audit log ({events.length} entries)</p>
              <button onClick={() => setOpen(false)} className="rounded-lg border border-edge p-1.5 text-dim hover:text-ink"><X size={14} /></button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {rows.map((e) => <Row key={e.id} e={e} />)}
            </div>
            <p className="border-t border-edge px-4 py-2 font-mono text-[8.5px] text-faint">Immutable audit trail — every AI decision + human override · exportable to divisional compliance cell</p>
          </div>
        </div>
      )}
    </div>
  );
}
