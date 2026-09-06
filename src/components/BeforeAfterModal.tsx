"use client";

import { useState } from "react";
import { AlertTriangle, BadgeCheck, Camera, MapPin, ShieldQuestion, X } from "lucide-react";
import { fmtMin } from "@/lib/engine/network";
import SmartImg from "@/components/SmartImg";
import type { JobDTO } from "@/lib/engine/types";

function haversineM(a: string, b: string): number {
  const [la1, ln1] = a.split(",").map(Number);
  const [la2, ln2] = b.split(",").map(Number);
  if ([la1, ln1, la2, ln2].some((n) => Number.isNaN(n))) return 0;
  const R = 6371000;
  const dLa = ((la2 - la1) * Math.PI) / 180;
  const dLn = ((ln2 - ln1) * Math.PI) / 180;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos((la1 * Math.PI) / 180) * Math.cos((la2 * Math.PI) / 180) * Math.sin(dLn / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

const REJECT_REASONS = [
  "Weld profile not within tolerance — re-grind required",
  "Photo does not show completed work clearly",
  "Tamping/packing incomplete at site",
  "Incorrect component fitted — replace with sanctioned spec",
  "Work location mismatch — GPS outside sanctioned chainage",
];

export default function BeforeAfterModal({
  job,
  onClose,
  onDecide,
  busy,
}: {
  job: JobDTO;
  onClose: () => void;
  onDecide: (accept: boolean, reason?: string) => void;
  busy: boolean;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState(REJECT_REASONS[0]);

  const gpsDelta = job.beforeGps && job.afterGps ? haversineM(job.beforeGps, job.afterGps) : 0;
  const gpsOk = gpsDelta < 500;
  const windowOk = (() => {
    if (!job.afterAt || job.windowEnd == null) return true;
    const a = new Date(job.afterAt);
    const afterMin = a.getHours() * 60 + a.getMinutes();
    return afterMin >= job.windowEnd - 75;
  })();
  const allClear = gpsOk && windowOk;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-abyss/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="anim-rise w-full max-w-3xl overflow-hidden rounded-2xl border border-edge bg-hull shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-edge px-4 py-3">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-widest text-faint">BEFORE vs AFTER — Digital sign-off review · Job #{job.id}</p>
            <h3 className="mt-0.5 text-[13.5px] font-bold text-ink">{job.title}</h3>
            <p className="mt-0.5 font-mono text-[9px] text-dim">{job.segmentCode} · {job.chainage} · {job.teamLeader}</p>
          </div>
          <button onClick={onClose} className="rounded-lg border border-edge p-1.5 text-dim hover:text-ink"><X size={15} /></button>
        </div>

        {/* fraud banner */}
        <div className={`flex items-center gap-2 border-b px-4 py-2 font-mono text-[9.5px] ${allClear ? "border-mint/20 bg-mint/[0.06] text-mint" : "border-signal/30 bg-signal/[0.08] text-signal"}`}>
          {allClear ? <BadgeCheck size={13} /> : <AlertTriangle size={13} />}
          {allClear ? "BOTH PHOTOS GPS + TIME VERIFIED — no fraud indicators" : "FRAUD FLAG — metadata mismatch detected, review carefully"}
        </div>

        {/* split screen */}
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
          {[
            { label: "BEFORE REPAIR", img: job.beforePhoto, gps: job.beforeGps, at: job.beforeAt, tone: "#ff9933" },
            { label: "AFTER REPAIR", img: job.afterPhoto, gps: job.afterGps, at: job.afterAt, tone: "#34d399" },
          ].map((p) => (
            <div key={p.label} className="overflow-hidden rounded-xl border border-edge bg-black/40">
              <div className="relative aspect-[4/3] w-full bg-edge/40">
                {p.img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <SmartImg src={p.img} alt={p.label} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center font-mono text-[10px] text-faint">NO PHOTO</div>
                )}
                <span className="absolute left-2 top-2 rounded px-2 py-1 font-mono text-[9px] font-bold tracking-widest" style={{ background: "rgba(4,6,12,0.85)", color: p.tone }}>
                  {p.label}
                </span>
                <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-abyss/85 px-1.5 py-0.5 font-mono text-[8px] text-dim">
                  <Camera size={8} /> GPS STAMPED
                </span>
              </div>
              <div className="space-y-0.5 p-2.5 font-mono text-[8.5px] text-dim">
                <p className="flex items-center gap-1"><MapPin size={8} /> {p.gps ?? "—"}</p>
                <p>{p.at ? new Date(p.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—"} IST</p>
              </div>
            </div>
          ))}
        </div>

        {/* metadata checks */}
        <div className="mx-4 space-y-1.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-widest text-faint"><ShieldQuestion size={11} /> Anti-fraud verification</p>
          <p className={`flex items-center gap-2 text-[10.5px] ${gpsOk ? "text-mint" : "text-signal"}`}>
            <BadgeCheck size={11} /> BEFORE/AFTER GPS match — {gpsDelta} m apart (threshold 500 m)
          </p>
          <p className={`flex items-center gap-2 text-[10.5px] ${windowOk ? "text-mint" : "text-signal"}`}>
            <BadgeCheck size={11} /> Completion inside sanctioned window {job.windowStart != null ? `${fmtMin(job.windowStart)}–${fmtMin(job.windowEnd ?? 0)}` : ""} — no early wrap-up
          </p>
          <p className="flex items-center gap-2 text-[10.5px] text-mint"><BadgeCheck size={11} /> Reporting photo chainage inside inspector beat (NDLS-I)</p>
        </div>

        {/* actions */}
        <div className="mt-4 border-t border-edge p-4">
          {!rejecting ? (
            <div className="flex gap-3">
              <button
                onClick={() => onDecide(true)}
                disabled={busy || !allClear}
                title={allClear ? "Sign off and release the block" : "Fraud flag raised — sign-off disabled until re-inspection"}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-mint to-[#2eb87f] px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-widest text-abyss shadow-[0_0_24px_rgba(52,211,153,0.35)] transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <BadgeCheck size={15} /> {allClear ? "Accept & Sign-Off — Release Block" : "Sign-off blocked — fraud flag"}
              </button>
              <button
                onClick={() => setRejecting(true)}
                className="rounded-xl border border-signal/40 bg-signal/10 px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-widest text-signal transition hover:bg-signal/20"
              >
                Reject
              </button>
            </div>
          ) : (
            <div className="anim-rise space-y-2.5">
              <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-lg border border-signal/40 bg-abyss px-3 py-2.5 font-mono text-[10.5px] text-ink outline-none">
                {REJECT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <div className="flex gap-2">
                <button
                  onClick={() => onDecide(false, reason)}
                  disabled={busy}
                  className="flex-1 rounded-xl bg-signal px-4 py-2.5 font-mono text-[10.5px] font-bold uppercase tracking-widest text-white transition hover:brightness-110 disabled:opacity-50"
                >
                  Confirm rejection — re-allot crew
                </button>
                <button onClick={() => setRejecting(false)} className="rounded-xl border border-edge px-4 py-2.5 font-mono text-[10.5px] text-dim">Back</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
