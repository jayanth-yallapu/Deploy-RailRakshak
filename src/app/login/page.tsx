"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ChevronLeft, HardHat, KeyRound, Radio, ShieldCheck, TrainFront, Wrench } from "lucide-react";
import { DEPT_LABEL, ROLE_META, setRole, type Dept, type Role } from "@/lib/role";

const CARDS: { role: Role; icon: React.ReactNode; tint: string; line: string }[] = [
  { role: "DRM", icon: <ShieldCheck size={18} />, tint: "#4d7cc7", line: "Strategic Command Center — KPIs, approvals, human veto" },
  { role: "CONTROL", icon: <Radio size={18} />, tint: "#34d399", line: "Traffic Control Center — live trains, what-if, block release" },
  { role: "INSPECTOR", icon: <HardHat size={18} />, tint: "#f5a524", line: "Field Operations — validation, allotment, sign-off" },
  { role: "KARMI", icon: <Wrench size={18} />, tint: "#a78bfa", line: "My Job Portal — job cards, GPS photo proof at site" },
];

export default function LoginPage() {
  const router = useRouter();
  const [dept, setDept] = useState<Dept>("ENG");
  const [entering, setEntering] = useState<Role | null>(null);
  const [karmiOpen, setKarmiOpen] = useState(false);

  function enter(role: Role) {
    setEntering(role);
    setRole({ role, dept: role === "KARMI" ? dept : undefined });
    router.push(ROLE_META[role].dest);
  }

  return (
    <div className="flex min-h-screen flex-col bg-abyss">
      <div className="tricolor" />

      {/* official header */}
      <header className="border-b border-edge/70 bg-hull">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br from-saffron to-amber text-abyss">
            <TrainFront size={22} strokeWidth={2.2} />
          </span>
          <div className="flex-1">
            <p className="text-[16px] font-bold tracking-[0.1em] text-ink">RAIL RAKSHAK</p>
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-faint">
              AI-Powered Automatic Block Planning · Ministry of Railways · SIH 2026 #26027
            </p>
          </div>
          <span className="hidden items-center gap-1.5 rounded-full border border-mint/25 bg-mint/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-widest text-mint md:flex">
            <span className="anim-blink h-1.5 w-1.5 rounded-full bg-mint" /> AI core online
          </span>
        </div>
      </header>

      <main className="gridlines mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-5 py-10">
        <div className="grid items-start gap-8 lg:grid-cols-[1fr_380px]">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-amber">Operator sign-in</p>
            <h1 className="mt-2 text-3xl font-bold leading-tight text-ink sm:text-4xl">
              One railway.<br />Four desks.
            </h1>
            <p className="mt-4 max-w-md text-[13.5px] leading-relaxed text-dim">
              Pick your desk to enter the demo environment. Each role opens a working
              command centre wired to the same live Delhi-NCR grid — the AI orchestrates,
              the railway decides.
            </p>
            <div className="mt-6 space-y-1.5 font-mono text-[9.5px] text-faint">
              <p>▸ Demo credentials are pre-authorized for evaluation</p>
              <p>▸ All four roles share one grid, one truth, one audit trail</p>
              <p>
                ▸ Patroller handset view:{" "}
                <Link href="/patrol" className="text-cyan hover:underline">field phone →</Link>
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {CARDS.map((c) => (
              <div key={c.role}>
                <button
                  onClick={() => (c.role === "KARMI" ? setKarmiOpen((v) => !v) : enter(c.role))}
                  className="group flex w-full items-center gap-3 rounded-lg border bg-panel px-4 py-3.5 text-left transition hover:border-white/25"
                  style={{ borderColor: entering === c.role || (c.role === "KARMI" && karmiOpen) ? c.tint : undefined }}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md" style={{ background: `${c.tint}1c`, color: c.tint }}>
                    {c.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-bold text-ink group-hover:text-white">{ROLE_META[c.role].label}</span>
                    <span className="block truncate text-[10.5px] text-faint">{c.line}</span>
                  </span>
                  {c.role !== "KARMI" && <ArrowRight size={14} className="shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-ink" />}
                </button>

                {c.role === "KARMI" && karmiOpen && (
                  <div className="anim-rise mt-2 rounded-lg border border-violet/30 bg-violet/[0.07] p-3">
                      <p className="font-mono text-[8.5px] uppercase tracking-widest text-violet">Crew division</p>
                      <div className="mt-2 grid grid-cols-3 gap-1.5">
                        {(["ENG", "TRD", "SNT"] as Dept[]).map((d) => (
                          <button
                            key={d}
                            onClick={() => setDept(d)}
                            className={`rounded-md border px-2 py-2 font-mono text-[10px] font-bold transition ${dept === d ? "border-violet bg-violet/25 text-violet" : "border-white/10 text-dim"}`}
                          >
                            {d}
                          </button>
                        ))}
                      </div>
                      <p className="mt-2 text-[9.5px] text-dim">{DEPT_LABEL[dept]}</p>
                      <button
                        onClick={() => enter("KARMI")}
                        className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-lg bg-violet px-4 py-2.5 font-mono text-[10.5px] font-bold uppercase tracking-widest text-abyss transition hover:brightness-110"
                      >
                        <KeyRound size={12} /> Enter job portal
                      </button>
                    </div>
                )}
              </div>
            ))}
            <Link href="/" className="flex items-center gap-1.5 pt-2 font-mono text-[10px] uppercase tracking-widest text-faint hover:text-ink">
              <ChevronLeft size={12} /> Mission briefing
            </Link>
          </div>
        </div>
      </main>

      <footer className="border-t border-edge/60 bg-hull px-5 py-3">
        <p className="mx-auto max-w-5xl font-mono text-[8.5px] uppercase tracking-[0.2em] text-faint">
          Northern Railway · Delhi Division · Field-ready prototype for Smart India Hackathon 2026
        </p>
        <p className="mx-auto mt-1 max-w-5xl font-mono text-[8px] text-faint">
          Demo sign-in is a presentation stub (client-side role). Production: CRIS SSO + signed JWT with route-level RBAC — see README.
        </p>
      </footer>
    </div>
  );
}
