"use client";

import { useMemo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Boxes,
  BrainCircuit,
  CloudFog,
  Cpu,
  FileCheck2,
  Fingerprint,
  GitBranch,
  KeyRound,
  Radar,
  ShieldHalf,
  Siren,
  Timer,
  TrafficCone,
  TrainFront,
  Waves,
  Zap,
} from "lucide-react";
import RailMap from "@/components/RailMap";
import { SEGMENTS, STATIONS, project } from "@/lib/engine/network";
import { getLiveTrains } from "@/lib/engine/livetrains";
import type { SegmentDTO, StationDTO } from "@/lib/engine/types";

const stDTO: StationDTO[] = STATIONS.map((s, i) => {
  const p = project(s.lat, s.lng);
  return { id: i + 1, code: s.code, name: s.name, kind: s.kind, x: p.x, y: p.y, lat: s.lat, lng: s.lng, dailyTrains: s.dailyTrains, vipZone: s.vipZone };
});
const sgDTO: SegmentDTO[] = SEGMENTS.map((s, i) => ({
  id: i + 1, code: s.code, fromCode: s.from, toCode: s.to, corridor: s.corridor, lengthKm: s.lengthKm,
  isBridge: !!s.isBridge, isLevelCrossing: !!s.isLevelCrossing, dailyTrains: s.dailyTrains, criticality: s.criticality,
}));

const ENGINES = [
  { icon: Fingerprint, color: "#34d399", n: "E1", title: "Trained Risk Model", tech: "Logistic regression · fitted in-app", desc: "A genuinely fitted classifier scores every defect's 72-h failure probability from severity, overdue days, asset health, traffic and criticality. Holdout accuracy is computed at runtime and published on the model card — not hardcoded." },
  { icon: GitBranch, color: "#38bdf8", n: "E2", title: "Cascade Graph Engine", tech: "graph ripple model", desc: "The grid as a living graph — stations as nodes, sections as edges. The cascade lab predicts how one block ripples across the network with decay per hop and ₹ delay cost, before it is approved." },
  { icon: BrainCircuit, color: "#f5a524", n: "E3", title: "Constraint Solver", tech: "exact window search + crew CP", desc: "Wave-packing bundles departments into super-blocks; an exact constraint sweep then places every block at its delay-minimizing window under crew-capacity and single-occupancy rules. 500 km solved in seconds." },
  { icon: Zap, color: "#a78bfa", n: "E4", title: "Tactical Rescheduler", tech: "rolling 4-h planner", desc: "A train fails, fog rolls in, a VIP moves — the rolling planner admits urgent defects into live COA vacuum slots within the next four hours, fully autonomously." },
  { icon: FileCheck2, color: "#ff9933", n: "E5", title: "Safety Document Engine", tech: "IRS-2024 ruleset · template-generated", desc: "Drafts the compliant Block Safety Work Order with rule citations and sign-offs in about a second. Manual process: 4–6 hours. (Roadmap: fine-tuned LLM drafting.)" },
  { icon: Waves, color: "#22d3ee", n: "E6", title: "Monte Carlo Stress-Test", tech: "500 runs / plan", desc: "Every plan is stress-tested against injected fog, freight surges, VIP movements and asset failures. The full delay histogram is persisted and rendered — the schedule with the tightest deviation wins." },
];

const CONSTRAINTS = [
  { icon: CloudFog, label: "Zero-visibility fog physics", sub: "DAS acoustic sensing takes over at 50 m" },
  { icon: ShieldHalf, label: "VVIP silent corridors", sub: "5 km NDLS sanctum · RPF/IB feeds" },
  { icon: Waves, label: "Two Yamuna rail bridges", sub: "pre-computed bridge-failure doctrine" },
  { icon: TrainFront, label: "10,000 T DFC super-heavies", sub: "braking geometry on gradients respected" },
  { icon: Zap, label: "RRTS EMI de-confliction", sub: "NCRTC shared-window scheduling" },
  { icon: TrafficCone, label: "DTP urban interface", sub: "LC gates avoided in city rush hours" },
];

const HORIZONS = [
  { k: "T+4 h", title: "Rolling micro plan", desc: "Updated every 5 minutes from COA feeds. A delayed Rajdhani's vacuum slot becomes a 20-minute micro-block nearby." },
  { k: "7 d", title: "Weekly strategic plan", desc: "Constraint-solved, Monte-Carlo validated, signed by the DRM and published to every department." },
  { k: "90 d", title: "Seasonal adaptive plan", desc: "Fog season de-weights physical inspection; summer hunts OHE sag; monsoon watches embankments." },
  { k: "< 60 s", title: "Crisis fallback", desc: "Fracture on a Yamuna bridge in fog with a VVIP special inbound — doctrine fires in seconds, not hours." },
];

const METRICS: [string, string, string][] = [
  ["Unscheduled emergency blocks", "0", "5–10 / month"],
  ["Multi-dept super-block overlap", "≥ 70% target", "< 10% today"],
  ["Weekly asset downtime", "↓ 40–45% in demo", "manual BDMS baseline"],
  ["Avg delay from maintenance", "~7 min in demo", "25–40 min"],
  ["Replan after disruption", "< 60 s", "4–6 h manual"],
  ["Safety document generation", "< 1 s", "4–6 h manual"],
  ["Field photo fraud leakage", "GPS-gated sign-off", "paper attestations"],
];

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 22 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.6, delay, ease: "easeOut" as const },
});

/** Hand-drawn system diagram — the "engineering whiteboard" moment. */
function ArchitectureDiagram() {
  const src = ["TMS", "TDMS", "SMMS", "COA", "FOIS", "IMD"];
  const out = ["COA release", "NTES", "SIMRAN", "Karmi phones", "Inspector", "DRM desk"];
  return (
    <svg viewBox="0 0 900 300" className="w-full">
      <defs>
        <marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6" fill="none" stroke="#3a4c6b" strokeWidth="1.2" />
        </marker>
      </defs>
      {src.map((s, i) => (
        <g key={s}>
          <rect x="20" y={22 + i * 44} width="110" height="30" rx="6" fill="#0a101c" stroke="#1b2436" />
          <text x="75" y={41 + i * 44} textAnchor="middle" fontSize="11" fill="#93a1b8" fontFamily="var(--font-jb)">{s}</text>
          <line x1="130" y1={37 + i * 44} x2="270" y2="150" stroke="#3a4c6b" strokeWidth="1" markerEnd="url(#arr)" strokeDasharray="4 3" />
        </g>
      ))}
      <rect x="270" y="110" width="150" height="80" rx="10" fill="rgba(52,211,153,0.06)" stroke="#34d399" strokeOpacity="0.5" />
      <text x="345" y="143" textAnchor="middle" fontSize="11" fontWeight="700" fill="#34d399" fontFamily="var(--font-jb)">DEPT SCORES</text>
      <text x="345" y="160" textAnchor="middle" fontSize="8.5" fill="#59687f" fontFamily="var(--font-jb)">departmental scores only</text>
      <text x="345" y="174" textAnchor="middle" fontSize="8.5" fill="#59687f" fontFamily="var(--font-jb)">zero raw data leaves zones</text>
      <line x1="420" y1="150" x2="480" y2="150" stroke="#3a4c6b" strokeWidth="1.2" markerEnd="url(#arr)" />
      <rect x="480" y="96" width="180" height="108" rx="10" fill="rgba(245,165,36,0.06)" stroke="#f5a524" strokeOpacity="0.6" />
      <text x="570" y="122" textAnchor="middle" fontSize="12" fontWeight="700" fill="#f5a524" fontFamily="var(--font-jb)">RAKSHAK CORE</text>
      {["score defects", "bundle super-blocks", "exact window placement", "simulate ×500"].map((t, i) => (
        <text key={t} x="570" y={140 + i * 14} textAnchor="middle" fontSize="8.5" fill="#93a1b8" fontFamily="var(--font-jb)">{t}</text>
      ))}
      {out.map((s, i) => (
        <g key={s}>
          <rect x="770" y={22 + i * 44} width="110" height="30" rx="6" fill="#0a101c" stroke="#1b2436" />
          <text x="825" y={41 + i * 44} textAnchor="middle" fontSize="10" fill="#93a1b8" fontFamily="var(--font-jb)">{s}</text>
          <line x1="660" y1="150" x2="770" y2={37 + i * 44} stroke="#3a4c6b" strokeWidth="1" markerEnd="url(#arr)" strokeDasharray="4 3" />
        </g>
      ))}
      <text x="450" y="286" textAnchor="middle" fontSize="9" fill="#59687f" fontFamily="var(--font-jb)" letterSpacing="3">
        SOURCES → PRIVACY-PRESERVING INFERENCE → OPTIMIZATION ENGINE → EVERY DESK
      </text>
    </svg>
  );
}

export default function Landing() {
  const trains = useMemo(() => getLiveTrains(), []);
  return (
    <div className="min-h-screen overflow-x-clip bg-abyss text-ink">
      {/* ================= HERO ================= */}
      <section className="relative flex min-h-screen flex-col">
        <div className="absolute inset-0 opacity-[0.32]">
          <RailMap stations={stDTO} segments={sgDTO} liveTrains={trains} />
          <div className="absolute inset-0 bg-gradient-to-b from-abyss/70 via-abyss/40 to-abyss" />
          <div className="absolute inset-0 bg-gradient-to-r from-abyss/80 via-transparent to-abyss/70" />
        </div>

        <header className="relative z-10 border-b border-white/[0.06]">
          <div className="tricolor" />
          <div className="flex items-center justify-between px-5 py-4 lg:px-10">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-saffron to-amber text-abyss">
                <TrainFront size={19} strokeWidth={2.4} />
              </span>
              <div>
                <p className="text-[14px] font-bold tracking-[0.12em]">RAIL RAKSHAK</p>
                <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-faint">Automatic block planning for Indian Railways</p>
              </div>
            </div>
            <div className="hidden items-center gap-2 font-mono text-[9px] uppercase tracking-[0.16em] text-dim md:flex">
              <span className="rounded-full border border-edge px-3 py-1.5">SIH 2026 · PS #26027</span>
              <span className="rounded-full border border-saffron/40 bg-saffron/10 px-3 py-1.5 text-saffron">Ministry of Railways</span>
              <Link href="/login" className="rounded-full border border-mint/50 bg-mint/10 px-3 py-1.5 font-bold text-mint transition hover:bg-mint/20">
                <KeyRound size={10} className="mr-1 inline" /> Sign in — 4 roles
              </Link>
            </div>
          </div>
        </header>

        <div className="relative z-10 flex flex-1 flex-col justify-center px-5 py-16 lg:px-10">
          <motion.p {...fade(0)} className="font-mono text-[10px] uppercase tracking-[0.3em] text-mint">
            TMS × SMMS × TDMS × COA — one mind for the Delhi grid
          </motion.p>
          <motion.h1 {...fade(0.08)} className="mt-4 max-w-4xl text-5xl font-bold leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">
            Maintenance blocks,<br />
            <span className="text-amber">finally planned by data</span><br />
            instead of phone calls.
          </motion.h1>
          <motion.p {...fade(0.16)} className="mt-6 max-w-xl text-[14px] leading-relaxed text-dim">
            RAIL RAKSHAK reads every defect feeding in from TMS, TDMS and SMMS, predicts which
            assets will fail, and packs the repairs into bundled &ldquo;super-blocks&rdquo; at
            the hours trains can spare the track. Field crews photograph the proof.
            Inspectors sign off on it. The corridor turns green again.
          </motion.p>
          <motion.div {...fade(0.24)} className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/login" className="group flex items-center gap-2 rounded-lg bg-amber px-6 py-3.5 font-mono text-[12px] font-bold uppercase tracking-widest text-abyss transition hover:brightness-110">
              <Radar size={15} /> Open the demo console <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" />
            </Link>
            <Link href="/simulation" className="flex items-center gap-2 rounded-lg border border-white/15 px-6 py-3.5 font-mono text-[12px] font-bold uppercase tracking-widest text-dim transition hover:border-signal/50 hover:text-signal">
              <Siren size={15} /> See the 60-second crisis test
            </Link>
          </motion.div>
          <motion.div {...fade(0.32)} className="mt-10 flex flex-wrap gap-x-8 gap-y-3 font-mono text-[10px] text-faint">
            {[
              ["19 IR sections · 4 RRTS links", "real Delhi-NCR geography"],
              ["24 trains", "real numbers, live positions"],
              ["4 roles", "one grid, one audit trail"],
            ].map(([v, l]) => (
              <div key={l}>
                <p className="text-[15px] font-bold text-ink">{v}</p>
                <p className="mt-0.5 uppercase tracking-[0.14em]">{l}</p>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ================= PROBLEM ================= */}
      <section className="mx-auto max-w-6xl px-5 py-20 lg:px-8">
        <motion.p {...fade(0)} className="font-mono text-[10px] uppercase tracking-[0.3em] text-signal"><span className="sec-num">01</span>THE PROBLEM WE WERE HANDED</motion.p>
        <motion.h2 {...fade(0.05)} className="mt-3 max-w-3xl text-3xl font-bold leading-tight sm:text-4xl">
          Three departments. Three silos. <span className="text-dim">One corridor paying for it.</span>
        </motion.h2>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[
            { t: "Fragmented planning", d: "Engineering, Traction and S&T request blocks independently through BDMS — manual, decentralized, blind to each other.", n: "01" },
            { t: "Wasted windows", d: "One corridor, three separate blocks on three separate days. Asset availability bleeds while trains wait.", n: "02" },
            { t: "No foresight", d: "TMS, SMMS and TDMS hold defect gold — but nothing predicts which rail cracks before it snaps.", n: "03" },
            { t: "Reactive crises", d: "A fog morning + a VIP special + a bridge fracture = 6 hours of chaos managed over phone calls.", n: "04" },
          ].map((c, i) => (
            <motion.div key={c.t} {...fade(0.05 * i)} className="panel p-5">
              <span className="font-mono text-[10px] text-faint">{c.n}</span>
              <p className="mt-1.5 text-[15px] font-bold text-ink">{c.t}</p>
              <p className="mt-2 text-[12px] leading-relaxed text-dim">{c.d}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ================= ARCHITECTURE ================= */}
      <section className="border-y border-edge/60 bg-hull/50 py-20">
        <div className="mx-auto max-w-5xl px-5 lg:px-8">
          <motion.p {...fade(0)} className="font-mono text-[10px] uppercase tracking-[0.3em] text-cyan"><span className="sec-num">02</span>HOW THE SYSTEM ACTUALLY WORKS</motion.p>
          <motion.h2 {...fade(0.05)} className="mt-3 max-w-3xl text-3xl font-bold leading-tight sm:text-4xl">
            One pipeline, drawn honestly.
          </motion.h2>
          <motion.p {...fade(0.08)} className="mt-3 max-w-2xl text-[13px] leading-relaxed text-dim">
            Departmental systems expose scores through documented contracts. The core scores, bundles,
            schedules and stress-tests blocks — then pushes the outcome to every desk that needs it,
            from the DRM&apos;s approval queue to the Karmi&apos;s phone at Km 1382.
          </motion.p>
          <motion.div {...fade(0.1)} className="panel mt-8 p-4">
            <ArchitectureDiagram />
          </motion.div>
        </div>
      </section>

      {/* ================= ENGINE ================= */}
      <section className="mx-auto max-w-6xl px-5 py-20 lg:px-8">
        <motion.p {...fade(0)} className="font-mono text-[10px] uppercase tracking-[0.3em] text-mint"><span className="sec-num">03</span>THE COGNITIVE ENGINE</motion.p>
        <motion.h2 {...fade(0.05)} className="mt-3 max-w-3xl text-3xl font-bold leading-tight sm:text-4xl">
          Six subsystems, <span className="text-dim">one orchestrator.</span>
        </motion.h2>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {ENGINES.map((e, i) => (
            <motion.div key={e.title} {...fade(0.05 * (i % 3))} className="panel p-5">
              <div className="flex items-center justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-md" style={{ background: `${e.color}16`, color: e.color }}>
                  <e.icon size={17} />
                </span>
                <span className="font-mono text-[9px] uppercase tracking-widest text-faint">{e.n} · {e.tech}</span>
              </div>
              <p className="mt-3.5 text-[15px] font-bold" style={{ color: e.color }}>{e.title}</p>
              <p className="mt-2 text-[12px] leading-relaxed text-dim">{e.desc}</p>
            </motion.div>
          ))}
        </div>
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CONSTRAINTS.map((c, i) => (
            <motion.div key={c.label} {...fade(0.04 * (i % 3))} className="flex items-center gap-3 rounded-lg border border-edge/70 bg-white/[0.02] px-4 py-3">
              <c.icon size={16} className="shrink-0 text-amber" />
              <div>
                <p className="text-[12px] font-bold text-ink">{c.label}</p>
                <p className="font-mono text-[9px] uppercase tracking-wider text-faint">{c.sub}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ================= HORIZONS ================= */}
      <section className="border-y border-edge/60 bg-hull/50 py-20">
        <div className="mx-auto max-w-6xl px-5 lg:px-8">
          <motion.p {...fade(0)} className="font-mono text-[10px] uppercase tracking-[0.3em] text-cyan"><span className="sec-num">04</span>FOUR PLANNING HORIZONS</motion.p>
          <motion.h2 {...fade(0.05)} className="mt-3 max-w-3xl text-3xl font-bold leading-tight sm:text-4xl">
            From 5-minute vacuum slots <span className="text-dim">to 90-day seasons.</span>
          </motion.h2>
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {HORIZONS.map((h, i) => (
              <motion.div key={h.k} {...fade(0.06 * i)} className="panel relative overflow-hidden p-5">
                <p className="tabular text-[28px] font-bold text-cyan">{h.k}</p>
                <p className="mt-1 text-[13.5px] font-bold text-ink">{h.title}</p>
                <p className="mt-2 text-[11.5px] leading-relaxed text-dim">{h.desc}</p>
                <Timer size={46} className="absolute -bottom-2 -right-2 text-white/[0.04]" />
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ================= METRICS ================= */}
      <section className="mx-auto max-w-5xl px-5 py-20 lg:px-8">
        <motion.p {...fade(0)} className="font-mono text-[10px] uppercase tracking-[0.3em] text-amber"><span className="sec-num">05</span>WHAT WE MEASURED</motion.p>
        <motion.h2 {...fade(0.05)} className="mt-3 text-3xl font-bold leading-tight sm:text-4xl">Numbers from the running build.</motion.h2>
        <motion.div {...fade(0.1)} className="panel mt-10 overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-edge/70 font-mono text-[9px] uppercase tracking-[0.18em] text-faint">
                <th className="px-5 py-3">Metric</th>
                <th className="px-5 py-3">With RAKSHAK</th>
                <th className="hidden px-5 py-3 sm:table-cell">Today&apos;s baseline</th>
              </tr>
            </thead>
            <tbody>
              {METRICS.map(([m, target, base], i) => (
                <tr key={m} className={`border-b border-white/[0.04] ${i % 2 ? "bg-white/[0.015]" : ""}`}>
                  <td className="px-5 py-3 text-[12.5px] text-ink/90">{m}</td>
                  <td className="tabular px-5 py-3 font-mono text-[12.5px] font-bold text-mint">{target}</td>
                  <td className="tabular hidden px-5 py-3 font-mono text-[12px] text-faint sm:table-cell">{base}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>
        <motion.p {...fade(0.15)} className="mt-3 font-mono text-[9px] text-faint">
          Demo figures measured on the seeded Delhi-NCR scenario; baselines from the problem statement (SIH #26027).
        </motion.p>
      </section>

      {/* ================= CTA ================= */}
      <section className="relative overflow-hidden border-t border-edge/60 py-20 text-center">
        <div className="absolute inset-0 opacity-15">
          <RailMap stations={stDTO} segments={sgDTO} liveTrains={trains} />
          <div className="absolute inset-0 bg-gradient-to-t from-abyss via-abyss/70 to-abyss" />
        </div>
        <div className="relative z-10 mx-auto max-w-2xl px-5">
          <motion.div {...fade(0)}>
            <Boxes size={26} className="mx-auto text-amber" />
            <h2 className="mt-4 text-3xl font-bold leading-tight sm:text-4xl">
              Try the whole loop,<br />end to end.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-[13px] leading-relaxed text-dim">
              Sign in as the DRM, allot a crew as the Inspector, photograph the repair as the Karmi —
              then watch the block go red, and green again, on the live grid.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link href="/login" className="flex items-center gap-2 rounded-lg bg-amber px-6 py-3.5 font-mono text-[12px] font-bold uppercase tracking-widest text-abyss transition hover:brightness-110">
                <KeyRound size={14} /> Sign in — 4 roles
              </Link>
              <Link href="/patrol" className="flex items-center gap-2 rounded-lg border border-white/15 px-6 py-3.5 font-mono text-[12px] font-bold uppercase tracking-widest text-dim transition hover:text-ink">
                Patroller phone <ArrowRight size={14} />
              </Link>
            </div>
            <p className="mt-6 flex items-center justify-center gap-1.5 font-mono text-[9px] uppercase tracking-widest text-faint">
              <Cpu size={10} /> Feeds simulated for evaluation · workflow is fully functional
            </p>
          </motion.div>
        </div>
      </section>

      <footer className="border-t border-edge/60 px-5 py-5">
        <div className="tricolor mb-4 opacity-60" />
        <p className="text-center font-mono text-[9px] uppercase tracking-[0.22em] text-faint">
          RAIL RAKSHAK · SIH 2026 · PS #26027 · Ministry of Railways · Transportation &amp; Logistics · built for the nation&apos;s grid
        </p>
      </footer>
    </div>
  );
}
