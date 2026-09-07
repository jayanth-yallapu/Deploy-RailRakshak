"use client";

import { useState } from "react";
import Link from "next/link";
import { Camera, CheckCircle2, ChevronLeft, Loader2, MapPin, Satellite, TrainFront, ArrowRight } from "lucide-react";
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
  const [segIdx, setSegIdx] = useState(1);
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
    setTimeout(() => setGps(`${pt[0].toFixed(5)}°N, ${pt[1].toFixed(5)}°E`), 600);
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
    <div className="relative flex min-h-screen items-center justify-center gap-12 bg-abyss p-6 text-ink">
      <div className="absolute inset-0 gridlines opacity-50" />

      {/* Phone Simulator Frame */}
      <div className="relative z-10 w-[340px] shrink-0 rounded-[2.8rem] border-[8px] border-[#1c2638] bg-[#0c121e] p-3 shadow-2xl shadow-cyan-950/20">
        <div className="mx-auto mb-2 h-4 w-24 rounded-b-xl bg-[#1c2638]" />
        <div className="rounded-[2rem] border border-edge/80 bg-hull p-4">
          <div className="flex items-center justify-between border-b border-edge/60 pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
                <TrainFront size={16} />
              </span>
              <div>
                <p className="text-xs font-bold text-ink">RAKSHAK PATROL</p>
                <p className="text-[10px] text-dim">Gangman Field Handset v2.1</p>
              </div>
            </div>
            <span className="anim-blink h-2 w-2 rounded-full bg-emerald-400" />
          </div>

          <div className="mt-3 space-y-3">
            <div>
              <label className="block text-[11px] font-semibold text-dim">Observed Defect Type</label>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                {PRESETS.map((p, i) => (
                  <button
                    key={p.title}
                    type="button"
                    onClick={() => setPresetIdx(i)}
                    className={`rounded-lg border p-2 text-left transition ${
                      presetIdx === i
                        ? "border-amber-500/60 bg-amber-500/15 text-amber-300"
                        : "border-edge bg-panel/50 text-dim hover:text-ink"
                    }`}
                  >
                    <span className="block text-[10.5px] font-semibold leading-tight">{p.title}</span>
                    <span className="mt-0.5 block text-[9.5px] font-mono text-faint">{p.dept}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-dim">Track Section</label>
              <select
                value={segIdx}
                onChange={(e) => setSegIdx(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-edge bg-panel px-3 py-2 text-xs font-medium text-ink outline-none focus:border-amber-500/40"
              >
                {zoneSegs.map((s, i) => (
                  <option key={s.code} value={i}>
                    {s.code} · {s.corridor}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={acquireGps}
              className={`flex w-full items-center justify-center gap-2 rounded-xl border p-2.5 text-xs font-semibold transition ${
                satLock
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                  : "border-edge bg-panel text-dim hover:text-ink"
              }`}
            >
              <Satellite size={14} className={satLock ? "animate-pulse" : ""} />
              {satLock ? gps : "Acquire GPS Satellite Lock"}
            </button>

            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Observation note (e.g. ~9mm fracture)..."
              className="w-full rounded-xl border border-edge bg-panel px-3 py-2 text-xs text-ink placeholder:text-faint focus:border-amber-500/40 focus:outline-none"
            />

            <div className="overflow-hidden rounded-xl border border-edge bg-black/40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <SmartImg
                src={FIELD_PHOTOS[preset.dept as keyof typeof FIELD_PHOTOS].before}
                alt="Captured defect"
                className="aspect-[4/3] w-full object-cover"
              />
              <div className="flex items-center gap-1.5 bg-panel px-3 py-1.5 text-[10px] text-dim">
                <MapPin size={10} className="text-amber-400" />
                <span>EXIF GPS & Timestamp Auto-Embedded</span>
              </div>
            </div>

            {sent ? (
              <div className="anim-rise rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-center">
                <CheckCircle2 size={20} className="mx-auto text-emerald-400" />
                <p className="mt-1 text-xs font-bold text-emerald-300">Report #{sent} Transmitted</p>
                <p className="mt-0.5 text-[10.5px] text-dim">Appears in Section Inspector Pending Validation</p>
                <button
                  onClick={() => setSent(null)}
                  className="mt-2 text-xs font-semibold text-amber-400 hover:underline"
                >
                  Report another defect
                </button>
              </div>
            ) : (
              <button
                onClick={report}
                disabled={busy || !satLock}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-2.5 text-xs font-bold text-slate-950 shadow-md transition hover:bg-amber-400 disabled:opacity-40"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                {busy ? "Transmitting…" : "Capture Photo & Submit"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Descriptive side copy */}
      <div className="relative z-10 hidden max-w-sm lg:block">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-dim hover:text-ink transition"
        >
          <ChevronLeft size={14} /> Back to Desk Selection
        </Link>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-ink">
          The Track Patroller&apos;s Handset
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-dim">
          Every gangman and keyman carries Rakshak Patrol. A single photo capture locks GPS coordinates, derives exact chainage, and routes the ticket directly to the Section Inspector in under a second.
        </p>

        <div className="mt-6 space-y-2.5 rounded-2xl border border-edge bg-panel/50 p-4 text-xs text-dim">
          <p className="font-semibold text-ink">Key Features:</p>
          <ul className="space-y-1.5 text-[11px] text-dim leading-relaxed">
            <li>▸ Offline-first architecture for tunnels and remote cuttings</li>
            <li>▸ Automatic nearest-track GPS chainage calculation</li>
            <li>▸ Cryptographic EXIF photo stamp prevents fraudulent reporting</li>
            <li>▸ Direct real-time feed into the AI optimization backlog</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
