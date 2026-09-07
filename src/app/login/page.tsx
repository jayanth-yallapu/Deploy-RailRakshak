"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ChevronLeft, HardHat, KeyRound, Radio, ShieldCheck, TrainFront, Wrench, CheckCircle2 } from "lucide-react";
import { DEPT_LABEL, ROLE_META, setRole, type Dept, type Role } from "@/lib/role";

const CARDS: { role: Role; icon: React.ReactNode; tint: string; line: string; desc: string }[] = [
  {
    role: "DRM",
    icon: <ShieldCheck size={20} />,
    tint: "#3b82f6",
    line: "Divisional Railway Manager Desk",
    desc: "Executive KPI dashboard, high-level schedule approvals, and DRM human veto override.",
  },
  {
    role: "CONTROL",
    icon: <Radio size={20} />,
    tint: "#10b981",
    line: "Section Controller / COA Desk",
    desc: "Live train tracking board, what-if cascade simulation, and live block release control.",
  },
  {
    role: "INSPECTOR",
    icon: <HardHat size={20} />,
    tint: "#f59e0b",
    line: "Senior Section Engineer (P.Way)",
    desc: "Field validation, gang allotment, anti-fraud GPS photo verification, and digital sign-off.",
  },
  {
    role: "KARMI",
    icon: <Wrench size={20} />,
    tint: "#8b5cf6",
    line: "Field Maintenance Karmi Portal",
    desc: "Active permit to work cards, site safety checklists, and GPS before/after photo upload.",
  },
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
    <div className="flex min-h-screen flex-col bg-abyss text-ink">
      <div className="tricolor" />

      {/* Official Header */}
      <header className="border-b border-edge/80 bg-hull/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-slate-950 shadow-md">
              <TrainFront size={22} strokeWidth={2.2} />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-tight text-ink">RAIL RAKSHAK</span>
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                  SIH 2026 #26027
                </span>
              </div>
              <p className="text-xs text-dim">Ministry of Railways · Northern Railway (Delhi Division)</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-dim">
            <span className="h-2 w-2 rounded-full bg-emerald-400 anim-blink" />
            <span className="hidden sm:inline">Orchestrator Online</span>
          </div>
        </div>
      </header>

      <main className="gridlines mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-5 py-12 sm:px-8">
        <div className="grid items-start gap-10 lg:grid-cols-[1fr_420px]">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-dim hover:text-ink transition"
            >
              <ChevronLeft size={14} /> Back to Project Overview
            </Link>
            <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
              Select Your Operating Desk
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-dim">
              Experience the end-to-end railway maintenance lifecycle from four distinct operational perspectives, all connected to the same live Delhi-NCR railway grid.
            </p>

            <div className="mt-8 space-y-3 rounded-2xl border border-edge/80 bg-panel/40 p-4 text-xs text-dim">
              <div className="flex items-center gap-2 font-medium text-ink">
                <CheckCircle2 size={15} className="text-emerald-400" />
                <span>Pre-Authorized Evaluation Environment</span>
              </div>
              <p className="pl-6 text-[11px] leading-relaxed text-faint">
                Role-based access is active in demo mode. All four desks share a single source of truth, unified risk models, and an immutable audit trail.
              </p>
              <div className="pl-6 pt-1">
                <Link href="/patrol" className="inline-flex items-center gap-1 text-amber-400 hover:underline">
                  Open Gangman Handset Simulator <ArrowRight size={12} />
                </Link>
              </div>
            </div>
          </div>

          {/* Role Cards List */}
          <div className="space-y-3">
            {CARDS.map((c) => (
              <div key={c.role} className="rounded-xl border border-edge/80 bg-panel shadow-sm transition hover:border-edge">
                <button
                  onClick={() => (c.role === "KARMI" ? setKarmiOpen((v) => !v) : enter(c.role))}
                  className="group flex w-full items-center gap-3.5 p-4 text-left transition"
                >
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition"
                    style={{ backgroundColor: `${c.tint}18`, color: c.tint }}
                  >
                    {c.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-ink group-hover:text-amber-400 transition">
                        {ROLE_META[c.role].label}
                      </span>
                      <ArrowRight size={14} className="text-faint transition group-hover:translate-x-1 group-hover:text-ink" />
                    </div>
                    <p className="text-xs text-dim">{c.line}</p>
                    <p className="mt-1 text-[11px] text-faint leading-relaxed line-clamp-2">{c.desc}</p>
                  </div>
                </button>

                {c.role === "KARMI" && karmiOpen && (
                  <div className="anim-rise border-t border-edge/80 bg-hull/60 p-4 rounded-b-xl">
                    <label className="block text-xs font-semibold text-dim">Select Department Discipline</label>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {(["ENG", "TRD", "SNT"] as Dept[]).map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setDept(d)}
                          className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                            dept === d
                              ? "border-purple-500 bg-purple-500/20 text-purple-300"
                              : "border-edge bg-panel/60 text-dim hover:text-ink"
                          }`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-dim">{DEPT_LABEL[dept]}</p>
                    <button
                      onClick={() => enter("KARMI")}
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-purple-500"
                    >
                      <KeyRound size={13} /> Enter Job Portal
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer className="border-t border-edge/80 bg-hull px-5 py-4 text-center text-xs text-faint">
        Northern Railway · Delhi Division · Smart India Hackathon 2026
      </footer>
    </div>
  );
}
