"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ClipboardCheck, Clock3, HardHat, Inbox, Loader2, Send, Star, X, MapPin } from "lucide-react";
import RailMap from "@/components/RailMap";
import BeforeAfterModal from "@/components/BeforeAfterModal";
import SmartImg from "@/components/SmartImg";
import { DEPT_COLORS, INSPECTOR_ZONE, KARMI_TEAMS, fmtMin } from "@/lib/engine/network";
import type { DashboardState, JobDTO } from "@/lib/engine/types";

const WINDOWS = [
  { label: "Golden 00:30–03:30 (Night)", start: 30, end: 210 },
  { label: "Golden+ 00:30–04:30 (Extended)", start: 30, end: 270 },
  { label: "Shoulder 10:45–13:15 (Midday)", start: 645, end: 795 },
];

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
    if (!force && sig === lastSig.current) return;
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
  const blockedIds = zoneJobs.filter((j) => j.status === "IN_PROGRESS").map((j) => j.segmentId);

  return (
    <div className="anim-rise space-y-4">
      {/* Zone Header */}
      <section className="panel flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30">
            <HardHat size={20} />
          </span>
          <div>
            <h2 className="text-base font-bold text-ink">Section Inspector — Field Operations Desk</h2>
            <p className="text-xs text-dim">{INSPECTOR_ZONE.name} · Assigned Sections: {INSPECTOR_ZONE.sections.join(" · ")}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-400">
            {pending.length} Pending Allotment
          </span>
          <span className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-400">
            {active.length} Active on Track
          </span>
          <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-400">
            {awaiting.length} Ready for Sign-Off
          </span>
        </div>
      </section>

      {/* Grid: Map on Left, Active Worklists on Right */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Track Jurisdiction Map */}
        <section className="panel xl:col-span-1 overflow-hidden flex flex-col">
          <div className="panel-hd">
            <span>Inspector Beat Focus</span>
            <span className="text-[10px] text-emerald-400 font-mono">NDLS Sector</span>
          </div>
          <div className="gridlines relative flex-1 p-2 bg-[#070b13]">
            <RailMap
              stations={dash.stations}
              segments={dash.segments}
              blockedSegmentIds={blockedIds}
              fog={dash.settings.fogMode}
              vip={dash.settings.vipAlert}
              liveTrains={dash.liveTrains}
              dimExcept={INSPECTOR_ZONE.sections}
            />
          </div>
        </section>

        {/* Actionable Tickets */}
        <section className="xl:col-span-2 space-y-4">
          {/* Awaiting Review (Verification & Sign-off) */}
          {awaiting.length > 0 && (
            <div className="panel border-emerald-500/40 bg-emerald-500/[0.02]">
              <div className="panel-hd border-emerald-500/20 text-emerald-400">
                <span className="flex items-center gap-2">
                  <ClipboardCheck size={14} /> Completed Repairs Awaiting Sign-Off ({awaiting.length})
                </span>
                <span className="text-xs font-normal text-dim">Tamper-Proof Photo Verification</span>
              </div>
              <div className="divide-y divide-edge/60">
                {awaiting.map((j) => (
                  <div key={j.id} className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-white/[0.02] transition">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-amber-400">#{j.id}</span>
                        <h4 className="text-xs font-bold text-ink truncate">{j.title}</h4>
                        <span className="rounded px-1.5 py-0.2 text-[10px] font-semibold" style={{ color: DEPT_COLORS[j.department] }}>
                          {j.department}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-dim">
                        Section <strong className="font-mono text-ink">{j.segmentCode}</strong> · {j.chainage} · Crew: {j.teamLeader}
                      </p>
                    </div>

                    <button
                      onClick={() => setReviewJob(j)}
                      className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 shadow transition hover:bg-emerald-400"
                    >
                      <ClipboardCheck size={14} /> Review & Sign-Off Block
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pending Validation / Allotment */}
          <div className="panel">
            <div className="panel-hd">
              <span>Reported Defects Pending Gang Allotment ({pending.length})</span>
              <span className="text-xs text-dim font-normal">Step 1: Crew & Window Allotment</span>
            </div>
            <div className="divide-y divide-edge/60 max-h-80 overflow-y-auto">
              {pending.length === 0 && (
                <p className="p-8 text-center text-xs text-dim">All defects in your beat are currently allotted.</p>
              )}
              {pending.map((j) => (
                <div key={j.id} className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-white/[0.02] transition">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-amber-400">#{j.id}</span>
                      <h4 className="text-xs font-bold text-ink">{j.title}</h4>
                      <span className="rounded px-1.5 py-0.2 text-[10px] font-semibold" style={{ color: DEPT_COLORS[j.department] }}>
                        {j.department}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-dim">
                      {j.segmentCode} · {j.chainage} · {j.note}
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      setAllotTarget(j);
                      setTeamSel((prev) => ({ ...prev, [j.id]: `${KARMI_TEAMS[j.department][0].id} — ${KARMI_TEAMS[j.department][0].leader}` }));
                    }}
                    className="flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-1.5 text-xs font-semibold text-amber-400 hover:bg-amber-500/20 transition"
                  >
                    <Send size={12} /> Allot Crew & Window
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Active on Track */}
          <div className="panel">
            <div className="panel-hd">
              <span>Crews Active on Track ({active.length})</span>
              <span className="text-xs text-dim font-normal">Real-Time Site Execution</span>
            </div>
            <div className="divide-y divide-edge/60 max-h-64 overflow-y-auto">
              {active.length === 0 && (
                <p className="p-6 text-center text-xs text-dim">No crews currently occupying the track.</p>
              )}
              {active.map((j) => (
                <div key={j.id} className="flex items-center justify-between p-3.5 hover:bg-white/[0.02]">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-ink">#{j.id}</span>
                      <span className="text-xs font-bold text-ink">{j.title}</span>
                      <span className={`rounded px-1.5 py-0.2 text-[10px] font-bold ${j.status === "IN_PROGRESS" ? "bg-amber-500/15 text-amber-400" : "bg-sky-500/15 text-sky-400"}`}>
                        {j.status === "IN_PROGRESS" ? "On Site / Working" : "Allotted"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-dim">
                      {j.segmentCode} · Leader: <strong className="text-ink">{j.teamLeader}</strong> · Window: {j.windowStart != null ? `${fmtMin(j.windowStart)}–${fmtMin(j.windowEnd ?? 0)} IST` : "Pending"}
                    </p>
                  </div>
                  {j.beforePhoto && (
                    <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                      <CheckCircle2 size={12} /> Before-Photo Locked
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Allotment Popup Modal */}
      {allotTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" onClick={() => setAllotTarget(null)}>
          <div className="anim-rise w-full max-w-md overflow-hidden rounded-2xl border border-amber-500/30 bg-hull shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-edge px-5 py-3.5">
              <div>
                <p className="text-xs font-bold text-amber-400">Allot Maintenance Block</p>
                <h3 className="text-sm font-bold text-ink mt-0.5">{allotTarget.title}</h3>
              </div>
              <button onClick={() => setAllotTarget(null)} className="rounded-lg p-1 text-dim hover:text-ink"><X size={15} /></button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-dim mb-1.5">Assign Gang Team Leader</label>
                <select
                  value={teamSel[allotTarget.id] ?? ""}
                  onChange={(e) => setTeamSel((prev) => ({ ...prev, [allotTarget.id]: e.target.value }))}
                  className="w-full rounded-xl border border-edge bg-panel px-3 py-2 text-xs font-medium text-ink outline-none"
                >
                  {KARMI_TEAMS[allotTarget.department]?.map((t) => (
                    <option key={t.id} value={`${t.id} — ${t.leader}`}>
                      {t.id} · {t.leader} ({t.crew} members · {t.exp})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-dim mb-1.5">Sanctioned Block Window</label>
                <div className="space-y-1.5">
                  {WINDOWS.map((w, idx) => (
                    <button
                      key={w.label}
                      type="button"
                      onClick={() => setWinSel((prev) => ({ ...prev, [allotTarget.id]: idx }))}
                      className={`flex w-full items-center justify-between rounded-xl border p-3 text-xs font-medium transition ${
                        (winSel[allotTarget.id] ?? 0) === idx
                          ? "border-amber-500/60 bg-amber-500/15 text-amber-300"
                          : "border-edge bg-panel text-dim hover:text-ink"
                      }`}
                    >
                      <span>{w.label}</span>
                      <span className="font-mono text-faint">{fmtMin(w.start)}–{fmtMin(w.end)}</span>
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={confirmAllot}
                disabled={busy !== null}
                className="w-full rounded-xl bg-amber-500 py-2.5 text-xs font-bold text-slate-950 shadow transition hover:bg-amber-400 disabled:opacity-50"
              >
                {busy === allotTarget.id ? "Allotting…" : "Confirm Allotment & Transmit Permit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review Modal */}
      {reviewJob && (
        <BeforeAfterModal
          job={reviewJob}
          onClose={() => setReviewJob(null)}
          onDecide={decide}
          busy={busy === reviewJob.id}
        />
      )}
    </div>
  );
}
