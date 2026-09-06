"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { KeyRound, OctagonAlert, ShieldCheck, TrainFront, X, Zap, Siren, User, FileWarning } from "lucide-react";
import { getRole, ROLE_META, DEPT_LABEL, type RoleInfo } from "@/lib/role";

const VETO_REASONS = [
  { id: "VIP / Political Sensitivity", icon: Zap },
  { id: "Unscheduled Emergency", icon: Siren },
  { id: "Human Judgement", icon: User },
  { id: "Incorrect AI Risk Assessment", icon: FileWarning },
];

const TITLES: Record<string, { title: string; sub: string }> = {
  "/command": { title: "Command Center", sub: "Real Delhi-NCR grid · 19 IR sections · 4 RRTS links · 24 real trains tracked" },
  "/planner": { title: "AI Block Planner", sub: "Constraint solver · super-block bundling · Monte-Carlo validated" },
  "/simulation": { title: "Simulation Lab", sub: "Cascade what-if · Final-Boss crisis protocol" },
  "/field": { title: "Field Operations", sub: "Defect validation · crew allotment · digital sign-off" },
  "/jobs": { title: "My Job Portal", sub: "GenAI job cards · GPS photo proof · super-block alerts" },
};

export default function TopBar() {
  const path = usePathname();
  const meta = TITLES[path] ?? { title: "RAIL RAKSHAK", sub: "" };
  const [now, setNow] = useState<string>("");
  const [role, setRoleState] = useState<RoleInfo | null>(null);
  const [planStatus, setPlanStatus] = useState<string>("PROPOSED");
  const [vetoBusy, setVetoBusy] = useState(false);
  const [vetoOpen, setVetoOpen] = useState(false);
  const [vetoReason, setVetoReason] = useState(VETO_REASONS[0].id);
  const [vetoNote, setVetoNote] = useState("");

  useEffect(() => {
    setRoleState(getRole());
    const sync = () => setRoleState(getRole());
    window.addEventListener("rr-role", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("rr-role", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (res.ok) {
        const d = await res.json();
        setPlanStatus(d.settings?.planStatus ?? "PROPOSED");
      }
    } catch {
      /* offline-tolerant */
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus, path]);

  useEffect(() => {
    const f = () => setNow(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }));
    f();
    const t = setInterval(f, 1000);
    return () => clearInterval(t);
  }, []);

  async function submitVeto(resume = false) {
    if (role?.role !== "DRM") return;
    setVetoBusy(true);
    try {
      await fetch("/api/veto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(resume ? { mode: "PROPOSED" } : { mode: "VETOED", reason: vetoReason, note: vetoNote }),
      });
      await fetchStatus();
      window.dispatchEvent(new Event("rr-veto"));
      setVetoOpen(false);
      setVetoNote("");
    } finally {
      setVetoBusy(false);
    }
  }

  const meta_role = role ? ROLE_META[role.role] : null;

  return (
    <header className="sticky top-0 z-20 border-b border-edge/70 bg-abyss/95">
      <div className="tricolor" />
      <div className="flex h-[52px] items-center justify-between gap-3 px-4 lg:px-6">
      <div className="flex items-center gap-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-saffron to-amber text-abyss lg:hidden">
          <TrainFront size={15} />
        </span>
        <div>
          <h1 className="text-[14px] font-bold leading-tight tracking-wide text-ink">{meta.title}</h1>
          <p className="hidden font-mono text-[9px] uppercase tracking-[0.18em] text-faint sm:block">{meta.sub}</p>
        </div>
        {role && meta_role && (
          <span
            className="ml-2 hidden items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[8.5px] font-bold uppercase tracking-widest md:flex"
            style={{ borderColor: `${meta_role.color}55`, background: `${meta_role.color}14`, color: meta_role.color }}
          >
            <ShieldCheck size={9} />
            {role.role === "KARMI" && role.dept ? DEPT_LABEL[role.dept].toUpperCase() : meta_role.badge.toUpperCase()}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {role?.role === "DRM" && (
          <button
            onClick={() => (planStatus === "VETOED" ? submitVeto(true) : setVetoOpen(true))}
            disabled={vetoBusy}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 font-mono text-[10px] font-bold uppercase tracking-widest transition ${
              planStatus === "VETOED"
                ? "animate-pulse bg-signal text-white shadow-[0_0_24px_rgba(255,77,79,0.5)]"
                : "border border-signal/50 bg-signal/15 text-signal hover:bg-signal/25"
            }`}
          >
            <OctagonAlert size={13} />
            {planStatus === "VETOED" ? "VETO ACTIVE — RESUME AI" : "HUMAN VETO"}
          </button>
        )}
        {planStatus === "APPROVED" && (
          <span className="hidden rounded-full border border-mint/40 bg-mint/10 px-2.5 py-1 font-mono text-[8.5px] font-bold uppercase tracking-widest text-mint md:block">
            Plan approved by DRM
          </span>
        )}
        {!role && (
          <Link href="/login" className="flex items-center gap-1.5 rounded-lg border border-amber/40 bg-amber/10 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-amber hover:bg-amber/20">
            <KeyRound size={12} /> Sign in
          </Link>
        )}
        <span className="hidden items-center gap-1.5 rounded-full border border-mint/25 bg-mint/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-widest text-mint md:flex">
          <span className="anim-blink h-1.5 w-1.5 rounded-full bg-mint" />
          AI core online
        </span>
        <span className="tabular font-mono text-[13px] font-semibold text-amber">{now || "--:--:--"} <span className="text-[9px] text-faint">IST</span></span>
      </div>
      </div>

      {/* HUMAN VETO modal with mandatory reason */}
      {vetoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-abyss/85 p-4 backdrop-blur-sm" onClick={() => setVetoOpen(false)}>
          <div className="anim-rise w-full max-w-md overflow-hidden rounded-2xl border border-signal/40 bg-hull shadow-[0_0_60px_rgba(255,77,79,0.25)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-signal/30 bg-signal/[0.08] px-4 py-3">
              <p className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-widest text-signal">
                <OctagonAlert size={14} /> DRM Human Veto — Override AI Plan
              </p>
              <button onClick={() => setVetoOpen(false)} className="rounded-lg border border-edge p-1 text-dim hover:text-ink"><X size={14} /></button>
            </div>
            <div className="space-y-3 p-4">
              <p className="text-[10.5px] leading-relaxed text-dim">This pauses the AI plan immediately and reverts corridors to manual BDMS supervision. The decision is immutably logged in the override audit trail (RLHF candidate set).</p>
              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-widest text-faint">Reason (required)</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {VETO_REASONS.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setVetoReason(r.id)}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[10px] font-semibold transition ${
                        vetoReason === r.id ? "border-signal/60 bg-signal/15 text-signal" : "border-edge text-dim hover:text-ink"
                      }`}
                    >
                      <r.icon size={12} /> {r.id}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-widest text-faint">Short note (required)</p>
                <textarea
                  value={vetoNote}
                  onChange={(e) => setVetoNote(e.target.value)}
                  rows={2}
                  placeholder="e.g. PMO confirmation pending for Yamuna Bridge intervention window…"
                  className="w-full rounded-lg border border-edge bg-abyss px-3 py-2 text-[11px] text-ink outline-none placeholder:text-faint"
                />
              </div>
              <button
                onClick={() => submitVeto(false)}
                disabled={vetoBusy || vetoNote.trim().length < 6}
                className="w-full rounded-xl bg-gradient-to-r from-signal to-[#ff7a45] px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-widest text-abyss shadow-[0_0_28px_rgba(255,77,79,0.4)] transition hover:brightness-110 disabled:opacity-50"
              >
                {vetoBusy ? "Invoking…" : "Invoke Veto — Pause AI Orchestrator"}
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
