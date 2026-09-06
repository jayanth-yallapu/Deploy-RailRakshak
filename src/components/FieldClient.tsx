"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ClipboardCheck, Clock3, HardHat, Inbox, Loader2, Send, Star, X } from "lucide-react";
import RailMap from "@/components/RailMap";
import BeforeAfterModal from "@/components/BeforeAfterModal";
import SmartImg from "@/components/SmartImg";
import { DEPT_COLORS, INSPECTOR_ZONE, KARMI_TEAMS, fmtMin } from "@/lib/engine/network";
import type { DashboardState, JobDTO } from "@/lib/engine/types";

const WINDOWS = [
  { label: "Golden 00:30–03:30", start: 30, end: 210 },
  { label: "Golden+ 00:30–04:30", start: 30, end: 270 },
  { label: "Shoulder 10:45–13:15", start: 645, end: 795 },
];

const EXCUSES_STARTUP = 5;

export default function FieldClient({ initialState, initialJobs }: { initialState: DashboardState; initialJobs: JobDTO[] }) {
  const [dash, setDash] = useState(initialState);
  const [jobs, setJobs] = useState(initialJobs);
  const [busy, setBusy] = useState<number | null>(null);
  const [reviewJob, setReviewJob] = useState<JobDTO | null>(null);
  const [allotTarget, setAllotTarget] = useState<JobDTO | null>(null);
  const [teamSel, setTeamSel] = useState<Record<number, string>>({});
  const [winSel, setWinSel] = useState<Record<number, number>>({});
  const [superSel, setSuperSel] = useState<Record<number, boolean>>({});

  const lastSig = useRef("");
  const refresh = useCallback(async (force = false) => {
    const [j, s] = await Promise.all([fetch("/api/jobs").then((r) => r.json()), fetch("/api/state", { cache: "no-store" }).then((r) => r.json())]);
    const sig = (j.jobs ?? []).map((x: JobDTO) => `${x.id}${x.status}${x.windowEnd}`).join("|") + s.settings.fogMode + s.settings.vipAlert + s.liveTrains.length;
    if (!force && sig === lastSig.current) return; // no change → no re-render
    lastSig.current = sig;
    setJobs(j.jobs ?? []);
    setDash(s);
  }, []);

  async function confirmAllot() {
    if (!allotTarget) return;
    const job = allotTarget;
    const team = teamSel[job.id] ?? `${KARMI_TEAMS[job.department][0].id} — ${KARMI_TEAMS[job.department][0].leader}`;
    const w = WINDOWS[winSel[job.id] ?? 0];
    setBusy(job.id);
    try {
      await fetch("/api/jobs/allot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, teamLeader: team, windowStart: w.start, windowEnd: w.end, isSuperBlock: !!superSel[job.id] }),
      });
      setAllotTarget(null);
      await refresh(true);
    } finally {
      setBusy(null);
    }
  }

  async function decide(accept: boolean, reason?: string) {
    if (!reviewJob) return;
    const id = reviewJob.id;
    setBusy(id);
    try {
      await fetch("/api/jobs/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: id, accept, reason }),
      });
      await refresh(true);
    } finally {
      setBusy(null);
    }
    setReviewJob(null);
  }

  useEffect(() => {
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  const zoneIds = new Set(dash.segments.filter((s) => INSPECTOR_ZONE.sections.includes(s.code)).map((s) => s.id));
  const zoneJobs = jobs.filter((j) => zoneIds.has(j.segmentId) && j.status !== "COMPLETED");
  const pending = zoneJobs.filter((j) => j.status === "PENDING");
  const active = zoneJobs.filter((j) => j.status === "ALLOTTED" || j.status === "IN_PROGRESS");
  const awaiting = zoneJobs.filter((j) => j.status === "AWAITING_REVIEW");
  const escalated = active.filter((j) => j.escalationLevel >= 2);
  const blockedIds = zoneJobs.filter((j) => j.status === "IN_PROGRESS").map((j) => j.segmentId);
  const newest = pending.slice(0, 2);

  return (
    <div className="anim-rise space-y-4">
      {/* zone header */}
      <section className="panel flex flex-wrap items-center gap-3 p-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber/15 text-amber"><HardHat size={19} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold text-ink">Section Inspector — Field Operations</p>
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-faint">{INSPECTOR_ZONE.name} · sections {INSPECTOR_ZONE.sections.join(" · ")}</p>
        </div>
        <div className="flex gap-2 font-mono text-[9px]">
          <span className="rounded-lg bg-signal/10 px-3 py-2 text-signal">{pending.length} PENDING VALIDATION</span>
          <span className="rounded-lg bg-amber/10 px-3 py-2 text-amber">{active.length} ON SITE</span>
          <span className="rounded-lg bg-mint/10 px-3 py-2 text-mint">{awaiting.length} AWAITING REVIEW</span>
        </div>
      </section>

      {/* escalation banner */}
      {escalated.map((j) => (
        <div key={j.id} className="anim-rise flex items-center gap-3 rounded-xl border border-signal/40 bg-signal/[0.08] px-4 py-2.5">
          <Clock3 size={15} className="shrink-0 animate-pulse text-signal" />
          <p className="flex-1 text-[11px] text-ink/90">
            <span className="font-bold text-signal">Crew unresponsive:</span> {j.title} — allotted {Math.round((Date.now() - new Date(j.updatedAt).getTime()) / 60000)} min ago, no start-capture. Re-allot or dispatch supervisor.
          </p>
          <button
            onClick={() => { setAllotTarget(j); setTeamSel({ ...teamSel, [j.id]: `${KARMI_TEAMS[j.department][1]?.id ?? KARMI_TEAMS[j.department][0].id} — ${KARMI_TEAMS[j.department][1]?.leader ?? KARMI_TEAMS[j.department][0].leader}` }); }}
            className="rounded-lg bg-signal px-3 py-1.5 font-mono text-[9.5px] font-bold uppercase tracking-widest text-white"
          >
            Re-allot
          </button>
        </div>
      ))}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* MAP + incoming feed */}
        <div className="space-y-4 xl:col-span-2">
          <section className="panel overflow-hidden">
            <div className="panel-hd"><span>Inspector beat — {blockedIds.length > 0 ? `${blockedIds.length} section(s) OCCUPIED (RED)` : "all sections open"}</span><span>real grid</span></div>
            <div className="bg-[#060b14] p-1">
              <RailMap
                stations={dash.stations}
                segments={dash.segments}
                fog={dash.settings.fogMode}
                vip={dash.settings.vipAlert}
                blockedSegmentIds={blockedIds}
                liveTrains={dash.liveTrains}
                dimExcept={INSPECTOR_ZONE.sections}
              />
            </div>
          </section>

          {/* incoming patroller feed */}
          <section className="panel">
            <div className="panel-hd">
              <span className="flex items-center gap-2"><Inbox size={12} className="text-cyan" /> Incoming patroller reports</span>
              <span className="rounded-full bg-cyan/15 px-2 py-0.5 font-mono text-[8.5px] font-bold text-cyan">{newest.length} new</span>
            </div>
            <div className="grid gap-2 p-2.5 sm:grid-cols-2">
              {newest.length === 0 && <p className="p-3 font-mono text-[9.5px] text-faint sm:col-span-2">Feed quiet — patrollers on rounds. Demo reports arrive via the Patroller Phone view (/patrol).</p>}
              {newest.map((j) => (
                <button key={j.id} onClick={() => setAllotTarget(j)} className="group flex gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5 text-left transition hover:border-cyan/40">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <SmartImg src={j.reportPhoto} alt={`Patroller report photo — ${j.title}`} className="h-14 w-[68px] shrink-0 rounded-lg border border-edge object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="anim-blink rounded bg-cyan/20 px-1.5 py-px font-mono text-[7.5px] font-bold text-cyan">NEW</span>
                      <span className="font-mono text-[8px] text-faint">{Math.max(EXCUSES_STARTUP, Math.round((Date.now() - new Date(j.reportAt).getTime()) / 60000))} min ago</span>
                    </div>
                    <p className="mt-0.5 truncate text-[10.5px] font-semibold text-ink/90 group-hover:text-ink">{j.title}</p>
                    <p className="font-mono text-[8px] text-faint">{j.chainage} · {j.reportGps}</p>
                  </div>
                  <Send size={12} className="mt-1 shrink-0 text-faint group-hover:text-cyan" />
                </button>
              ))}
            </div>
          </section>
        </div>

        {/* QUEUES */}
        <div className="flex flex-col gap-4">
          <section className="panel">
            <div className="panel-hd"><span>Pending validation — Step 1: allot</span><ClipboardCheck size={11} /></div>
            <div className="max-h-[330px] space-y-2 overflow-y-auto p-2.5">
              {pending.length === 0 && <p className="p-3 text-center font-mono text-[9.5px] text-mint">Queue clear — no unvalidated reports</p>}
              {pending.map((j) => {
                const teams = KARMI_TEAMS[j.department];
                const selTeam = teamSel[j.id] ?? `${teams[0].id} — ${teams[0].leader}`;
                return (
                  <div key={j.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
                    <div className="flex gap-2.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <SmartImg src={j.reportPhoto} alt={`Patroller report photo — ${j.title}`} className="h-14 w-[68px] shrink-0 rounded-lg border border-edge object-cover" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[10.5px] font-semibold leading-tight text-ink/90">{j.title}</p>
                        <p className="mt-0.5 font-mono text-[8px] text-faint">{j.chainage} · {j.reportGps}</p>
                        <p className="font-mono text-[8px]" style={{ color: DEPT_COLORS[j.department] }}>{j.department} · patroller report</p>
                      </div>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      <div className="relative">
                        <select value={selTeam} onChange={(e) => setTeamSel({ ...teamSel, [j.id]: e.target.value })} className="w-full rounded-md border border-edge bg-abyss px-2 py-1.5 font-mono text-[9.5px] text-ink outline-none">
                          {teams.map((t, i) => (
                            <option key={t.id} value={`${t.id} — ${t.leader}`}>
                              {i === 0 ? "★ " : ""}{t.id} — {t.leader} ({t.exp}, crew {t.crew})
                            </option>
                          ))}
                        </select>
                        {selTeam.includes(teams[0].id) && (
                          <span className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded bg-amber/20 px-1.5 py-0.5 font-mono text-[7.5px] font-bold text-amber">
                            <Star size={8} /> AI RECOMMENDED
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1.5">
                        <select value={winSel[j.id] ?? 0} onChange={(e) => setWinSel({ ...winSel, [j.id]: Number(e.target.value) })} className="flex-1 rounded-md border border-edge bg-abyss px-2 py-1.5 font-mono text-[9.5px] text-ink outline-none">
                          {WINDOWS.map((w, i) => <option key={i} value={i}>{w.label}</option>)}
                        </select>
                        <button
                          onClick={() => setSuperSel({ ...superSel, [j.id]: !superSel[j.id] })}
                          className={`rounded-md border px-2 py-1.5 font-mono text-[8.5px] font-bold ${superSel[j.id] ? "border-violet/50 bg-violet/15 text-violet" : "border-edge text-faint"}`}
                        >SUPER</button>
                      </div>
                      <button onClick={() => setAllotTarget(j)} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-[#b06c15] to-[#d1841c] px-3 py-2 font-mono text-[9.5px] font-bold uppercase tracking-widest text-abyss transition hover:brightness-110">
                        <CheckCircle2 size={11} /> Allot work to this crew
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="panel-hd"><span>Crews on site</span><Clock3 size={11} /></div>
            <div className="space-y-1.5 p-2.5">
              {active.length === 0 && <p className="p-2 text-center font-mono text-[9px] text-faint">No crews deployed</p>}
              {active.map((j) => (
                <div key={j.id} className="flex items-center gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${j.status === "IN_PROGRESS" ? "anim-blink bg-signal" : "bg-amber"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[10.5px] font-semibold text-ink/90">{j.title}</p>
                    <p className="font-mono text-[8px] text-faint">
                      {j.status === "IN_PROGRESS" ? `ON SITE since ${j.beforeAt ? new Date(j.beforeAt).toLocaleTimeString("en-IN", { timeStyle: "short" }) : ""}` : `ALLOTTED · window ${j.windowStart != null ? fmtMin(j.windowStart) : ""}–${j.windowEnd != null ? fmtMin(j.windowEnd) : ""}`}
                      {j.isSuperBlock ? " · SUPER-BLOCK" : ""}
                      {j.escalationLevel >= 1 ? ` · ESC LV${j.escalationLevel}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-[8.5px]" style={{ color: DEPT_COLORS[j.department] }}>{j.department}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-hd"><span>Step 4 — Review queue</span><span>{awaiting.length} waiting</span></div>
            <div className="max-h-[300px] space-y-2 overflow-y-auto p-2.5">
              {awaiting.length === 0 && <p className="p-3 text-center font-mono text-[9.5px] text-mint">Nothing awaiting sign-off</p>}
              {awaiting.map((j) => (
                <div key={j.id} className="rounded-xl border border-mint/15 bg-mint/[0.03] p-2.5">
                  <div className="flex gap-2">
                    <div className="flex shrink-0 gap-1">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <SmartImg src={j.beforePhoto} alt="Before repair photo" className="h-11 w-12 rounded border border-edge object-cover" />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <SmartImg src={j.afterPhoto} alt="After repair photo" className="h-11 w-12 rounded border border-mint/40 object-cover" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10.5px] font-semibold leading-tight text-ink/90">{j.title}</p>
                      <p className="mt-0.5 font-mono text-[8px] text-faint">{j.segmentCode} · {j.teamLeader}{j.isSuperBlock ? " · SUPER-BLOCK" : ""}</p>
                    </div>
                  </div>
                  <button onClick={() => setReviewJob(j)} className="mt-2 w-full rounded-lg bg-gradient-to-r from-mint to-[#2eb87f] px-3 py-2 font-mono text-[9.5px] font-bold uppercase tracking-widest text-abyss transition hover:brightness-110">
                    Open Before/After review
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      {/* allot confirm modal */}
      {allotTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-abyss/85 p-4 backdrop-blur-sm" onClick={() => setAllotTarget(null)}>
          <div className="anim-rise w-full max-w-md overflow-hidden rounded-2xl border border-amber/40 bg-hull" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-amber/30 bg-amber/[0.07] px-4 py-3">
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-amber">Confirm allotment</p>
              <button onClick={() => setAllotTarget(null)} className="rounded-lg border border-edge p-1 text-dim hover:text-ink"><X size={14} /></button>
            </div>
            <div className="space-y-3 p-4">
              <p className="text-[12px] font-semibold leading-snug text-ink">{allotTarget.title}</p>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 font-mono text-[9.5px] leading-relaxed text-dim">
                <p>Section: <span className="text-ink">{allotTarget.segmentCode} · {allotTarget.chainage}</span></p>
                <p>Crew: <span className="text-amber">{teamSel[allotTarget.id] ?? `${KARMI_TEAMS[allotTarget.department][0].id} — ${KARMI_TEAMS[allotTarget.department][0].leader}`}</span>{(teamSel[allotTarget.id] ?? "").includes(KARMI_TEAMS[allotTarget.department][0].id) ? " ★ AI pick" : ""}</p>
                <p>Window: <span className="text-ink">{WINDOWS[winSel[allotTarget.id] ?? 0].label}</span>{superSel[allotTarget.id] ? " · SUPER-BLOCK (multi-dept occupancy)" : ""}</p>
                <p className="mt-1 text-faint">Job card pushes instantly to the Karmi&apos;s device with GenAI safety permit attached.</p>
              </div>
              <button
                onClick={confirmAllot}
                disabled={busy === allotTarget.id}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#b06c15] to-[#d1841c] px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-widest text-abyss transition hover:brightness-110 disabled:opacity-50"
              >
                {busy === allotTarget.id ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                Allot & push job card
              </button>
            </div>
          </div>
        </div>
      )}

      {reviewJob && <BeforeAfterModal job={reviewJob} onClose={() => setReviewJob(null)} onDecide={decide} busy={busy === reviewJob.id} />}
    </div>
  );
}
