"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, Boxes, Camera, ChevronDown, Clock3, FileCheck2, Loader2, MapPin, Pause, Play, Printer, Satellite, ShieldCheck, Timer, WifiOff, Wrench, X } from "lucide-react";
import RailMap from "@/components/RailMap";
import SmartImg from "@/components/SmartImg";
import { DEPT_COLORS, KARMI_TEAMS, fmtMin } from "@/lib/engine/network";
import type { DashboardState, JobDTO } from "@/lib/engine/types";
import { getRole, DEPT_LABEL } from "@/lib/role";

const STEPS = ["Allotted", "On Site", "Photo Set", "Signed Off"];
function stageOf(status: string): number {
  return status === "ALLOTTED" ? 0 : status === "IN_PROGRESS" ? 1 : status === "AWAITING_REVIEW" ? 2 : 3;
}

function jobPermitText(job: JobDTO): string[] {
  return [
    `PERMIT TO WORK — Ref RR/PTW/${String(job.id).padStart(4, "0")} · issued by SSE/${job.department}/${job.segmentCode.split("-")[1]} under GR&SR 15.06.`,
    `LOCATION: ${job.chainage}, section ${job.segmentCode}. Sanctioned window ${job.windowStart != null ? `${fmtMin(job.windowStart)}–${fmtMin(job.windowEnd ?? 0)} IST` : "as allotted"} under traffic block. Lookout man mandatory.`,
    `SCOPE: ${job.title}. ${job.note}`,
    `PROTECTION: TSR 30 km/h on approach; detonators at 1200 m both ends; OHE ${job.department === "TRD" ? "earthed at both ends — power block taken" : "live — maintain 2 m clearance"}; walk on cess, never between running rails.`,
    `PROOF PROTOCOL: BEFORE photo at start + AFTER photo at completion, both GPS-stamped. Block releases only after Inspector digital sign-off.`,
    `EMERGENCY: contact Section Controller NDLS on railway phone; evacuate on two long whistle blasts. Auto-revocation on VVIP alert or visibility < 50 m.`,
  ];
}

function crewFor(job: JobDTO) {
  const id = job.teamLeader?.split(" — ")[0] ?? "";
  const team = KARMI_TEAMS[job.department]?.find((t) => id.startsWith(t.id));
  return team ? `${team.leader} + ${team.crew - 1} members` : (job.teamLeader ?? "");
}

const QUEUE_KEY = "rr.offlineQueue";
type QueuedShot = { url: string; body: Record<string, unknown>; jobId: number; at: number };

export default function JobsClient({ initialState, initialJobs }: { initialState: DashboardState; initialJobs: JobDTO[] }) {
  const [dash, setDash] = useState(initialState);
  const [jobs, setJobs] = useState(initialJobs);
  const [dept, setDept] = useState<"ENG" | "TRD" | "SNT">("ENG");
  const [busy, setBusy] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [permitJob, setPermitJob] = useState<JobDTO | null>(null);
  const [offline, setOffline] = useState(false);
  const [queue, setQueue] = useState<QueuedShot[]>([]);
  const [clock, setClock] = useState(Date.now());
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingAction = useRef<{ jobId: number; kind: "start" | "complete" } | null>(null);

  useEffect(() => {
    const r = getRole();
    if (r?.role === "KARMI" && r.dept) setDept(r.dept);
    try {
      setQueue(JSON.parse(window.localStorage.getItem(QUEUE_KEY) ?? "[]"));
    } catch {
      /* empty queue */
    }
    const t = setInterval(() => setClock(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  const lastSig = useRef("");
  const refresh = useCallback(async (force = false) => {
    const [j, s] = await Promise.all([fetch("/api/jobs").then((r) => r.json()), fetch("/api/state", { cache: "no-store" }).then((r) => r.json())]);
    const sig = (j.jobs ?? []).map((x: JobDTO) => `${x.id}${x.status}`).join("|") + s.settings.fogMode + s.liveTrains.length;
    if (!force && sig === lastSig.current) return;
    lastSig.current = sig;
    setJobs(j.jobs ?? []);
    setDash(s);
  }, []);

  useEffect(() => {
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  async function post(url: string, body: Record<string, unknown>, jobId: number) {
    if (offline) {
      const q = [...queue, { url, body, jobId, at: Date.now() }];
      setQueue(q);
      window.localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
      return;
    }
    setBusy(jobId);
    try {
      await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      await refresh(true);
    } finally {
      setBusy(null);
    }
  }

  async function syncQueue() {
    for (const q of queue) {
      await fetch(q.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(q.body) });
    }
    setQueue([]);
    window.localStorage.setItem(QUEUE_KEY, "[]");
    await refresh(true);
  }

  useEffect(() => {
    if (!offline && queue.length > 0) void syncQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline]);

  function capture(jobId: number, kind: "start" | "complete") {
    pendingAction.current = { jobId, kind };
    fileRef.current?.click();
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const action = pendingAction.current;
    e.target.value = "";
    if (!file || !action) return;
    const reader = new FileReader();
    reader.onload = () => {
      post(
        action.kind === "start" ? "/api/jobs/start" : "/api/jobs/complete",
        { jobId: action.jobId, photoData: String(reader.result) },
        action.jobId
      );
    };
    reader.readAsDataURL(file);
  }

  function printPermit(job: JobDTO) {
    const html = `<html><head><title>GenAI-JC-${job.id}</title><style>body{font-family:'Courier New',monospace;padding:40px;max-width:720px;margin:auto;color:#111}h1{font-size:16px}h2{font-size:12px;color:#444}p{font-size:11.5px;line-height:1.7}.sig{margin-top:48px;display:flex;justify-content:space-between}.sig div{border-top:1px solid #333;padding-top:6px;font-size:10px}</style></head><body><h1>PERMIT TO WORK — RR/PTW/${String(job.id).padStart(4, "0")}</h1><h2>RAIL RAKSHAK · GenAI Safety Job Card · Indian Railways NR Division</h2>${jobPermitText(job).map((l) => `<p>${l}</p>`).join("")}<div class="sig"><span style="display:none"></span><div>SSE/${job.department} Signature</div><div>Section Controller (COA)</div><div>RAKSHAK autoSigner v3</div></div><script>window.onload=()=>window.print()</script></body></html>`;
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
    }
  }

  const myJobs = jobs.filter((j) => j.department === dept && j.status !== "PENDING");
  const live = myJobs.filter((j) => j.status !== "COMPLETED");
  const done = myJobs.filter((j) => j.status === "COMPLETED");
  const superActive = live.find((j) => j.isSuperBlock);
  const escJob = live.find((j) => j.escalationLevel >= 1);
  const focusSections = [...new Set(myJobs.map((j) => j.segmentCode))];
  const blockedIds = myJobs.filter((j) => j.status === "IN_PROGRESS").map((j) => j.segmentId);

  const gpsTrack = useMemo(() => {
    // simulated crew handset position: 12–38 m from the reported defect (within 50 m on-site ring)
    const m: Record<number, { dist: number; gps: string; onSite: boolean }> = {};
    for (const j of live) {
      const dist = 12 + ((j.id * 7) % 27);
      const [la, ln] = (j.reportGps || "28.64290, 77.21970").split(",").map(Number);
      m[j.id] = { dist, gps: `${(la + 0.00008 * j.id).toFixed(5)}°N, ${(ln + 0.00005 * j.id).toFixed(5)}°E`, onSite: dist < 50 };
    }
    return m;
  }, [live]);

  return (
    <div className="anim-rise space-y-4">
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />

      {/* header */}
      <section className="panel flex flex-wrap items-center gap-3 p-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: `${DEPT_COLORS[dept]}22`, color: DEPT_COLORS[dept] }}>
          <Wrench size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold text-ink">My Job Portal — {DEPT_LABEL[dept]}</p>
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-faint">{live.length} live assignment(s) · {done.length} signed off</p>
        </div>
        <button
          onClick={() => setOffline(!offline)}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 font-mono text-[9.5px] font-bold uppercase tracking-widest transition ${offline ? "border-signal/50 bg-signal/15 text-signal" : "border-edge text-dim hover:text-ink"}`}
        >
          <WifiOff size={12} /> Offline mode: {offline ? "ON" : "OFF"}
        </button>
        {queue.length > 0 && (
          <button onClick={syncQueue} className="anim-blink rounded-lg bg-cyan/15 px-3 py-2 font-mono text-[9.5px] font-bold text-cyan">
            {queue.length} queued — tap to sync
          </button>
        )}
        <div className="flex gap-1.5">
          {(["ENG", "TRD", "SNT"] as const).map((d) => (
            <button key={d} onClick={() => setDept(d)} className={`rounded-lg px-3 py-2 font-mono text-[10px] font-bold transition ${dept === d ? "text-abyss" : "bg-white/[0.04] text-dim"}`} style={dept === d ? { background: DEPT_COLORS[d] } : undefined}>
              {d}
            </button>
          ))}
        </div>
      </section>

      {superActive && (
        <section className="anim-rise flex items-center gap-3 rounded-xl border border-violet/40 bg-violet/10 px-4 py-3">
          <Boxes size={17} className="shrink-0 text-violet" />
          <p className="text-[11.5px] text-ink/90">
            <span className="font-bold text-violet">SUPER-BLOCK ALERT:</span> your crew shares the corridor with ENG+TRD+SNT on{" "}
            <span className="font-mono text-[11px]">{superActive.segmentCode}</span> — simultaneous occupancy under single block. Maintain 50 m gang separation per IRS 2024 §3.1.
          </p>
        </section>
      )}

      {escJob && (
        <section className="anim-rise flex items-center gap-3 rounded-xl border border-amber/40 bg-amber/10 px-4 py-3">
          <Clock3 size={15} className="shrink-0 animate-pulse text-amber" />
          <p className="text-[11px] text-ink/90">
            <span className="font-bold text-amber">SMS reminder (auto-escalation LV{escJob.escalationLevel}):</span> Job #{escJob.id} was allotted{" "}
            {Math.round((Date.now() - new Date(escJob.updatedAt).getTime()) / 60000)} min ago — capture your BEFORE photo now, or the Inspector is auto-notified at T+30.
          </p>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
          {live.length === 0 && (
            <div className="panel flex flex-col items-center justify-center p-10 text-center">
              <ShieldCheck size={26} className="text-mint" />
              <p className="mt-3 font-mono text-[11px] text-dim">No live assignments for {dept} crew — stand by for allotment</p>
            </div>
          )}
          {live.map((job) => {
            const stage = stageOf(job.status);
            const gps = gpsTrack[job.id];
            const remaining = job.windowEnd != null ? job.windowEnd - (new Date(clock).getHours() * 60 + new Date(clock).getMinutes()) : null;
            const urgent = remaining != null && remaining > 0 && remaining < 30;
            return (
              <section key={job.id} className="panel overflow-hidden">
                <div className="border-b border-white/[0.05] p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {job.isSuperBlock && <span className="rounded bg-violet/15 px-1.5 py-0.5 font-mono text-[8.5px] font-bold text-violet">SUPER-BLOCK</span>}
                    {remaining != null && job.status !== "AWAITING_REVIEW" && (
                      <span className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[8.5px] font-bold ${urgent ? "anim-blink bg-signal/20 text-signal" : "bg-white/[0.05] text-dim"}`}>
                        <Timer size={9} /> {remaining > 0 ? `${Math.floor(remaining / 60)}h ${remaining % 60}m left` : "WINDOW EXPIRED"}
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-1 font-mono text-[8.5px] text-faint">
                      <Satellite size={9} className={gps?.onSite ? "text-mint" : "text-signal"} />
                      GPS {gps?.gps} — {gps?.onSite ? <span className="text-mint">On-Site ({gps.dist} m)</span> : <span className="text-signal">Off-Location</span>}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[13px] font-bold text-ink">{job.title}</p>
                  <p className="mt-0.5 font-mono text-[9px] text-dim">
                    {job.segmentCode} · {job.chainage} · window {job.windowStart != null ? `${fmtMin(job.windowStart)}–${fmtMin(job.windowEnd ?? 0)} IST` : "TBD"}
                  </p>
                  <p className="mt-0.5 font-mono text-[8.5px] text-faint">
                    Allotted by: {job.allottedBy ?? "—"} · Team: {crewFor(job)}
                  </p>

                  {/* status timeline */}
                  <div className="mt-3 flex items-center">
                    {STEPS.map((s, i) => (
                      <div key={s} className="flex flex-1 items-center last:flex-none">
                        <div className="flex flex-col items-center">
                          <span className={`flex h-5 w-5 items-center justify-center rounded-full border font-mono text-[8px] font-bold ${
                            i < stage ? "border-mint bg-mint text-abyss" : i === stage ? "border-amber bg-amber/20 text-amber" : "border-edge text-faint"
                          }`}>
                            {i < stage ? <BadgeCheck size={10} /> : i + 1}
                          </span>
                          <span className={`mt-1 whitespace-nowrap font-mono text-[7px] uppercase tracking-wider ${i <= stage ? "text-dim" : "text-edge"}`}>{s}</span>
                        </div>
                        {i < STEPS.length - 1 && <div className={`mx-1 mb-4 h-px flex-1 ${i < stage ? "bg-mint" : "bg-edge"}`} />}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-3.5">
                  {job.status === "ALLOTTED" && (
                    <div>
                      <p className="mb-2 font-mono text-[9px] uppercase tracking-widest text-faint">Stage 1 — reach site &amp; capture BEFORE photo</p>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => capture(job.id, "start")} disabled={busy === job.id || !gps?.onSite} className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-saffron to-amber px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-widest text-abyss transition hover:brightness-110 disabled:opacity-40">
                          {busy === job.id ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Start work — BEFORE photo
                        </button>
                        <button onClick={() => post("/api/jobs/start", { jobId: job.id }, job.id)} disabled={busy === job.id} className="rounded-lg border border-edge px-3 py-2.5 font-mono text-[9.5px] text-dim hover:text-ink">
                          Simulate capture
                        </button>
                        <button onClick={() => setPermitJob(job)} className="flex items-center gap-1.5 rounded-lg border border-mint/40 bg-mint/10 px-3 py-2.5 font-mono text-[9.5px] font-bold text-mint hover:bg-mint/20">
                          <FileCheck2 size={11} /> Safety permit (GenAI-JC-{job.id})
                        </button>
                      </div>
                      {!gps?.onSite && <p className="mt-2 flex items-center gap-1.5 font-mono text-[8.5px] text-signal"><MapPin size={9} /> Move within 50 m of the defect chainage to enable start</p>}
                    </div>
                  )}

                  {job.status === "IN_PROGRESS" && (
                    <div>
                      <div className="mb-2.5 flex items-center gap-2.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <SmartImg src={job.beforePhoto} alt="Before repair photo" className="h-16 w-24 rounded-lg border border-edge object-cover" />
                        <div className="font-mono text-[8.5px] leading-relaxed text-dim">
                          <p className="text-amber">BEFORE — captured &amp; verified</p>
                          <p>{job.beforeGps}</p>
                          <p>{job.beforeAt ? new Date(job.beforeAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : ""} IST</p>
                        </div>
                      </div>
                      <p className="mb-2 font-mono text-[9px] uppercase tracking-widest text-faint">Stage 2 — work in progress · complete &amp; capture AFTER photo</p>
                      <div className="flex flex-wrap gap-2">
                        <button className="flex items-center gap-2 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2.5 font-mono text-[9.5px] font-bold text-amber">
                          <Pause size={11} /> Pause
                        </button>
                        <button onClick={() => capture(job.id, "complete")} disabled={busy === job.id} className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-mint to-[#2eb87f] px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-widest text-abyss transition hover:brightness-110 disabled:opacity-40">
                          {busy === job.id ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />} Complete — AFTER photo
                        </button>
                        <button onClick={() => post("/api/jobs/complete", { jobId: job.id }, job.id)} disabled={busy === job.id} className="rounded-lg border border-edge px-3 py-2.5 font-mono text-[9.5px] text-dim hover:text-ink">
                          Simulate capture
                        </button>
                      </div>
                    </div>
                  )}

                  {job.status === "AWAITING_REVIEW" && (
                    <div className="flex items-center gap-3">
                      <div className="flex gap-1.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <SmartImg src={job.beforePhoto} alt="Before repair photo" className="h-14 w-[74px] rounded-lg border border-edge object-cover" />
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <SmartImg src={job.afterPhoto} alt="After repair photo" className="h-14 w-[74px] rounded-lg border border-mint/40 object-cover" />
                      </div>
                      <p className="text-[10.5px] text-dim">
                        Photo set submitted <span className="text-mint">{job.afterAt ? new Date(job.afterAt).toLocaleTimeString("en-IN", { timeStyle: "short" }) : ""}</span> — waiting for Inspector split-screen verification. Block releases automatically on sign-off.
                      </p>
                    </div>
                  )}
                </div>
              </section>
            );
          })}

          {done.length > 0 && (
            <section className="panel p-3.5">
              <p className="mb-2 font-mono text-[9px] uppercase tracking-widest text-faint">Signed-off history</p>
              {done.slice(0, 4).map((job) => (
                <div key={job.id} className="flex items-center gap-2 border-t border-white/[0.04] py-2 first:border-0">
                  <BadgeCheck size={13} className="shrink-0 text-mint" />
                  <p className="min-w-0 flex-1 truncate text-[10.5px] text-ink/80">{job.title}</p>
                  <span className="shrink-0 font-mono text-[8.5px] text-faint">{job.segmentCode}</span>
                </div>
              ))}
            </section>
          )}
        </div>

        <section className="panel h-fit overflow-hidden">
          <div className="panel-hd"><span>Your block location(s)</span><span>{blockedIds.length > 0 ? "OCCUPIED — RED" : "clear"}</span></div>
          <div className="bg-[#060b14] p-1">
            <RailMap
              stations={dash.stations}
              segments={dash.segments}
              fog={dash.settings.fogMode}
              blockedSegmentIds={blockedIds}
              liveTrains={dash.liveTrains}
              dimExcept={focusSections.length > 0 ? focusSections : undefined}
            />
          </div>
          <div className="border-t border-edge p-3 font-mono text-[8.5px] leading-relaxed text-faint">
            Chainage GPS auto-verified at photo capture · 50 m gang separation enforced · lookout man per GR&SR 15.09
          </div>
        </section>
      </div>

      {/* safety permit modal */}
      {permitJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-abyss/85 p-4 backdrop-blur-sm" onClick={() => setPermitJob(null)}>
          <div className="anim-rise w-full max-w-xl overflow-hidden rounded-2xl border border-mint/30 bg-hull" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-mint/25 bg-mint/[0.06] px-4 py-3">
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-mint">GenAI Safety Permit — RR/PTW/{String(permitJob.id).padStart(4, "0")}</p>
              <div className="flex items-center gap-2">
                <button onClick={() => printPermit(permitJob)} className="flex items-center gap-1.5 rounded-lg border border-mint/40 bg-mint/10 px-2.5 py-1.5 font-mono text-[9px] font-bold text-mint hover:bg-mint/20">
                  <Printer size={11} /> PDF
                </button>
                <button onClick={() => setPermitJob(null)} className="rounded-lg border border-edge p-1 text-dim hover:text-ink"><X size={14} /></button>
              </div>
            </div>
            <div className="space-y-2.5 p-4">
              {jobPermitText(permitJob).map((l, i) => (
                <p key={i} className="text-[11px] leading-relaxed text-ink/85">{l}</p>
              ))}
              <div className="mt-3 flex justify-between border-t border-white/[0.07] pt-3 font-mono text-[8.5px] text-faint">
                <span>SSE/{permitJob.department} ______</span>
                <span>Section Controller ______</span>
                <span>RAKSHAK autoSigner v3 ✓</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
