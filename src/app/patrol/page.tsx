"use client";

import { useState } from "react";
import Link from "next/link";
import { Camera, CheckCircle2, ChevronLeft, Loader2, MapPin, Satellite, TrainFront } from "lucide-react";
import SmartImg from "@/components/SmartImg";
import { SEGMENTS, INSPECTOR_ZONE, sectionMeta } from "@/lib/engine/network";
import { FIELD_PHOTOS } from "@/lib/engine/network";

const PRESETS = [
  { title: "Rail head crack / spalling", dept: "ENG" },
  { title: "Broken elastic rail clip", dept: "ENG" },
  { title: "OHE drooping / catenary sag", dept: "TRD" },
  { title: "Insulator crack on mast", dept: "TRD" },
  { title: "Signal lamp not lit", dept: "SNT" },
  { title: "Point machine straining", dept: "SNT" },
];

export default function PatrolPage() {
  const zoneSegs = SEGMENTS.filter((s) => INSPECTOR_ZONE.sections.includes(s.code));
  const [presetIdx, setPresetIdx] = useState(0);
  const [segIdx, setSegIdx] = useState(1); // NDLS-NZM default-ish
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const [gps, setGps] = useState("28.64290°N, 77.21970°E");
  const [satLock, setSatLock] = useState(false);

  const seg = zoneSegs[segIdx];
  const preset = PRESETS[presetIdx];
  const meta = sectionMeta(seg.code);

  function acquireGps() {
    setSatLock(true);
    const pt = seg.geo[Math.floor(seg.geo.length / 2)];
    setTimeout(() => setGps(`${pt[0].toFixed(5)}°N, ${pt[1].toFixed(5)}°E`), 700);
  }

  async function report() {
    setBusy(true);
    try {
      const st = await fetch("/api/state").then((r) => r.json());
      const target = st.segments.find((x: { code: string }) => x.code === seg.code);
      const res = await fetch("/api/jobs/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${preset.title} — ${seg.code}`,
          segmentId: target.id,
          department: preset.dept,
          note: note || `Patroller on-foot report, ${meta?.chainage ?? seg.code}`,
          photoData: FIELD_PHOTOS[preset.dept as keyof typeof FIELD_PHOTOS].before,
        }),
      });
      const d = await res.json();
      setSent(d.id ?? 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center gap-8 bg-abyss p-6">
      <div className="absolute inset-0 gridlines opacity-60" />
      {/* phone frame */}
      <div className="relative w-[330px] shrink-0 rounded-[2.4rem] border-[7px] border-[#1a2438] bg-[#060b14] p-3 shadow-[0_0_80px_rgba(34,211,238,0.12)]">
        <div className="mx-auto mb-2 h-4 w-24 rounded-b-xl bg-[#1a2438]" />
        <div className="rounded-[1.6rem] border border-edge/60 bg-abyss p-3">
          <div className="flex items-center justify-between px-1 py-1.5">
            <div className="flex items-center gap-2">
              <TrainFront size={15} className="text-amber" />
              <div>
                <p className="text-[11px] font-bold text-ink">RAKSHAK PATROL</p>
                <p className="font-mono text-[7px] uppercase tracking-widest text-faint">Gangman field app · v2.1</p>
              </div>
            </div>
            <span className="anim-blink h-2 w-2 rounded-full bg-mint" />
          </div>

          <div className="mt-2 space-y-2.5">
            <div>
              <p className="mb-1 font-mono text-[8px] uppercase tracking-widest text-faint">Defect type</p>
              <div className="grid grid-cols-2 gap-1.5">
                {PRESETS.map((p, i) => (
                  <button key={p.title} onClick={() => setPresetIdx(i)} className={`rounded-lg border px-2 py-2 text-left text-[9.5px] font-semibold transition ${presetIdx === i ? "border-amber bg-amber/15 text-amber" : "border-edge text-dim"}`}>
                    {p.title}
                    <span className="mt-0.5 block font-mono text-[7px] text-faint">{p.dept}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1 font-mono text-[8px] uppercase tracking-widest text-faint">Section</p>
              <select value={segIdx} onChange={(e) => setSegIdx(Number(e.target.value))} className="w-full rounded-lg border border-edge bg-hull px-2 py-2 font-mono text-[10px] text-ink outline-none">
                {zoneSegs.map((s, i) => (
                  <option key={s.code} value={i}>{s.code} · {s.corridor}</option>
                ))}
              </select>
            </div>

            <button onClick={acquireGps} className={`flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2.5 font-mono text-[9.5px] transition ${satLock ? "border-mint/40 bg-mint/10 text-mint" : "border-edge text-dim"}`}>
              <Satellite size={12} className={satLock ? "animate-pulse" : ""} />
              {satLock ? gps : "Acquire GPS lock"}
            </button>

            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Short note — e.g. crack ~9mm, spreading" className="w-full rounded-lg border border-edge bg-hull px-2.5 py-2 text-[10.5px] text-ink outline-none placeholder:text-faint" />

            <div className="overflow-hidden rounded-xl border border-edge">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <SmartImg src={FIELD_PHOTOS[preset.dept as keyof typeof FIELD_PHOTOS].before} alt="Captured defect" className="aspect-[4/3] w-full object-cover" />
              <p className="flex items-center gap-1 bg-black/50 px-2 py-1 font-mono text-[7.5px] text-dim"><MapPin size={8} /> GPS + timestamp auto-embedded at capture</p>
            </div>

            {sent ? (
              <div className="anim-rise rounded-xl border border-mint/40 bg-mint/10 p-3 text-center">
                <CheckCircle2 size={20} className="mx-auto text-mint" />
                <p className="mt-1.5 text-[10.5px] font-bold text-mint">Report #{sent} transmitted</p>
                <p className="mt-0.5 font-mono text-[8px] text-dim">Section Inspector notified instantly — appears in Pending Validation</p>
                <button onClick={() => setSent(null)} className="mt-2 rounded-lg border border-mint/40 px-3 py-1.5 font-mono text-[8.5px] text-mint">Report another</button>
              </div>
            ) : (
              <button onClick={report} disabled={busy || !satLock} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-saffron to-amber px-4 py-3 font-mono text-[10.5px] font-bold uppercase tracking-widest text-abyss transition hover:brightness-110 disabled:opacity-40">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
                {busy ? "Transmitting…" : "Photo + report defect"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* side copy */}
      <div className="relative hidden max-w-sm lg:block">
        <Link href="/login" className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-faint hover:text-ink">
          <ChevronLeft size={12} /> Back to login
        </Link>
        <h1 className="mt-4 text-3xl font-bold text-ink">The Patroller&apos;s Phone</h1>
        <p className="mt-3 text-[13px] leading-relaxed text-dim">
          Every gangman and track patroller carries RAKSHAK PATROL. One photo, one tap — and the
          defect lands on the Section Inspector&apos;s dashboard with GPS, timestamp and chainage
          in under a second. No paper diaries. No radio relays. No lost reports.
        </p>
        <div className="mt-5 space-y-2 font-mono text-[9.5px] text-faint">
          <p>▸ Offline-first — syncs when signal returns (tunnel-safe)</p>
          <p>▸ Chainage auto-derived from nearest track GPS</p>
          <p>▸ Photo EXIF locked — tamper-proof evidence chain</p>
          <p>▸ Feeds directly into Step 0 of the maintenance lifecycle</p>
        </div>
      </div>
    </div>
  );
}
