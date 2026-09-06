"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Activity, CloudFog, Eye, Radio, ShieldAlert, Thermometer, Timer, TrafficCone, TrainFront, Webhook, Wind, X } from "lucide-react";
import RailMap from "@/components/RailMap";
import KpiStrip from "@/components/KpiStrip";
import LiveFeed from "@/components/LiveFeed";
import LiveBoard from "@/components/LiveBoard";
import ConsensusMeter from "@/components/ConsensusMeter";
import SectionInspector from "@/components/SectionInspector";
import DrmRow from "@/components/DrmRow";
import { CORRIDOR_COLORS, DEPT_COLORS, fmtMin } from "@/lib/engine/network";
import { getRole, type RoleInfo } from "@/lib/role";
import type { DashboardState, SettingsDTO } from "@/lib/engine/types";

function Toggle({
  label,
  sub,
  on,
  color,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  sub: string;
  on: boolean;
  color: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      aria-label={`${label} — currently ${on ? "on" : "off"}`}
      className={`flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition disabled:opacity-50 ${
        on ? "border-white/20 bg-white/[0.06]" : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"
      }`}
    >
      <span style={{ color: on ? color : "#4a576d" }}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11.5px] font-bold tracking-wide" style={{ color: on ? color : "#8b98ad" }}>
          {label}: {on ? "ON" : "OFF"}
        </span>
        <span className="block truncate font-mono text-[8.5px] uppercase tracking-wider text-faint">{sub}</span>
      </span>
      <span className="relative shrink-0 rounded-full transition" style={{ height: 18, width: 36, background: on ? color : "#16202f" }}>
        <span
          className="absolute top-[3px] h-3 w-3 rounded-full transition-all"
          style={{ left: on ? 19 : 3, background: on ? "#04060c" : "#4a576d" }}
        />
      </span>
    </button>
  );
}

export default function CommandClient({ initial }: { initial: DashboardState }) {
  const [state, setState] = useState(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>("NZM-ANVT");
  const [role, setRole] = useState<RoleInfo | null>(null);
  const [extendBusy, setExtendBusy] = useState(false);
  const [webhookOpen, setWebhookOpen] = useState(false);

  useEffect(() => {
    setRole(getRole());
    const sync = () => setRole(getRole());
    window.addEventListener("rr-role", sync);
    return () => window.removeEventListener("rr-role", sync);
  }, []);

  const sigOf = (d: DashboardState) =>
    `${d.settings.fogMode}${d.settings.vipAlert}${d.settings.dtpRedZone}${d.settings.planStatus}|${d.counts.openDefects}|${d.events.length}|${d.liveTrains.length}|${d.activeBlockSegments.join(",")}|${d.latestPlan?.id ?? 0}|${d.overrun?.jobId ?? 0}|${d.overrun?.remainingMin ?? 0}`;
  const lastSig = useRef("__init__");

  const refresh = useCallback(async (force = false) => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (!res.ok) return;
      const d = (await res.json()) as DashboardState;
      const s = sigOf(d);
      // skip the re-render entirely when nothing changed — kills poll jitter
      if (force || s !== lastSig.current) {
        lastSig.current = s;
        setState(d);
      }
    } catch {
      /* keep last state */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setInterval(refresh, 12000);
    return () => clearInterval(t);
  }, [refresh]);

  async function toggle(key: keyof SettingsDTO) {
    setPending(key);
    try {
      await fetch("/api/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: !state.settings[key] }),
      });
      await refresh(true);
    } finally {
      setPending(null);
    }
  }

  const s = state.settings;
  const planBlocks = state.latestPlan?.blocks ?? [];
  const blockedIds = [
    ...new Set([
      ...planBlocks.filter((b) => b.day <= 1 && b.mode === "physical").map((b) => b.segmentId),
      ...state.activeBlockSegments, // crews physically on site (karmi before-photo captured)
    ]),
  ];
  const selectedSegment = useMemo(
    () => state.segments.find((sg) => sg.code === selectedCode) ?? null,
    [state.segments, selectedCode]
  );
  const runningCount = state.liveTrains.filter((t) => t.status === "RUNNING").length;

  const overrun = state.overrun;
  const firstBlock = state.latestPlan?.blocks[0] ?? null;

  async function preemptExtend() {
    if (!overrun) return;
    setExtendBusy(true);
    try {
      await fetch("/api/jobs/extend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: overrun.jobId, addMin: 30 }),
      });
      await refresh(true);
    } finally {
      setExtendBusy(false);
    }
  }

  return (
    <div className="anim-rise space-y-4">
      {/* Overrun early-warning banner */}
      {overrun && (
        <div className="anim-rise flex flex-wrap items-center gap-3 rounded-xl border border-amber/50 bg-amber/[0.08] px-4 py-2.5">
          <span className="flex items-center gap-2 font-mono text-[10.5px] font-bold uppercase tracking-widest text-amber">
            <Timer size={14} className="animate-pulse" /> HIGH OVERRUN RISK
          </span>
          <p className="min-w-0 flex-1 text-[11px] text-ink/90">
            Block #{overrun.jobId} ({overrun.segCode}) has <span className="font-bold text-amber">{overrun.remainingMin} min left, {overrun.donePct}% done</span> — overrun probability <span className="tabular font-bold text-signal">{overrun.probability.toFixed(0)}%</span>
          </p>
          <button
            onClick={preemptExtend}
            disabled={extendBusy}
            className="rounded-lg bg-amber px-3 py-1.5 font-mono text-[9.5px] font-bold uppercase tracking-widest text-abyss transition hover:brightness-110 disabled:opacity-50"
          >
            {extendBusy ? "Extending…" : "Pre-empt extend +30 min"}
          </button>
        </div>
      )}

      {role?.role === "DRM" && <DrmRow state={state} />}

      <KpiStrip state={state} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* MAP */}
        <section className="panel relative overflow-hidden xl:col-span-2">
          <div className="panel-hd">
            <span className="flex items-center gap-2">
              <Radio size={12} className="text-mint" /> Delhi NCR Live Grid — real geo · COA sync · {runningCount} trains running
            </span>
            <span className="flex items-center gap-3 font-mono text-[9px]">
              <span className="flex items-center gap-1 text-amber"><Thermometer size={10} />{state.weather.tempC}°C</span>
              <span className="flex items-center gap-1 text-cyan"><Wind size={10} />{state.weather.humidityPct}% RH</span>
              <span className={`flex items-center gap-1 ${s.fogMode ? "text-signal" : "text-mint"}`}>
                <Eye size={10} />VIS {state.weather.visibilityM >= 1000 ? `${(state.weather.visibilityM / 1000).toFixed(1)}km` : `${state.weather.visibilityM}m`}
              </span>
            </span>
          </div>
          <div className="gridlines relative bg-[#060b14] p-1">
            <RailMap
              stations={state.stations}
              segments={state.segments}
              fog={s.fogMode}
              vip={s.vipAlert}
              blockedSegmentIds={blockedIds}
              liveTrains={state.liveTrains}
              selectedSegment={selectedCode}
              onSelectSegment={(code) => setSelectedCode(code === selectedCode ? null : code)}
            />
            {s.fogMode && (
              <div className="absolute left-3 top-3 rounded-lg border border-signal/40 bg-abyss/80 px-3 py-2 backdrop-blur">
                <p className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-widest text-signal">
                  <CloudFog size={13} /> FOG MODE ENGAGED
                </p>
                <p className="mt-1 max-w-[300px] text-[10.5px] leading-snug text-dim">
                  Physical blocks suspended · DAS acoustic sensing + REMMLOT virtual inspection active · {state.counts.virtualInspections} remote diagnostics in queue
                </p>
              </div>
            )}
            {s.vipAlert && (
              <div className="absolute right-3 top-3 rounded-lg border border-amber/40 bg-abyss/80 px-3 py-2 backdrop-blur">
                <p className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-widest text-amber">
                  <ShieldAlert size={13} /> VVIP Silent Corridor
                </p>
                <p className="mt-1 text-[10.5px] text-dim">5 km sanctum · RPF/IB feed live · sub-critical blocks withheld</p>
              </div>
            )}
            <div className="pointer-events-none absolute bottom-2 left-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[8.5px] text-faint">
              {Object.entries(CORRIDOR_COLORS).map(([c, col]) => (
                <span key={c} className="flex items-center gap-1">
                  <span className="inline-block h-[3px] w-4 rounded-full" style={{ background: col }} />
                  {c}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* RIGHT COLUMN */}
        <section className="flex flex-col gap-4">
          <div className="panel">
            <div className="panel-hd"><span>Operating Modes</span><span className="text-[9px]">{pending ? "APPLYING…" : "INSTANT"}</span></div>
            <div className="space-y-2 p-3">
              <Toggle label="FOG MODE" sub="suspend physical · enable DAS acoustic scans" on={s.fogMode} color="#ff4d4f" icon={<CloudFog size={17} />} onClick={() => toggle("fogMode")} disabled={pending !== null} />
              <Toggle label="VVIP SILENT CORRIDOR" sub="5 km NDLS sanctum · RPF/IB live feed" on={s.vipAlert} color="#f5a524" icon={<ShieldAlert size={17} />} onClick={() => toggle("vipAlert")} disabled={pending !== null} />
              <Toggle label="DTP RED-ZONE SYNC" sub="avoid LC gates in city rush hours" on={s.dtpRedZone} color="#22d3ee" icon={<TrafficCone size={17} />} onClick={() => toggle("dtpRedZone")} disabled={pending !== null} />
            </div>
          </div>

          <div className="panel">
            <div className="panel-hd">
              <span className="flex items-center gap-2"><TrainFront size={12} className="text-amber" /> NTES Live Rail Traffic</span>
              <span className="text-[9px]">real schedules</span>
            </div>
            <LiveBoard trains={state.liveTrains} />
          </div>
        </section>
      </div>

      {/* ROW 3 — inspector + consensus + load + feed */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <section className="panel min-h-[260px]">
          <div className="panel-hd"><span>Section Inspector — click any track</span></div>
          <SectionInspector segment={selectedSegment} />
        </section>

        <section className="panel min-h-[260px]">
          <div className="panel-hd">
            <span>Cross-Department Consensus</span>
            <span className="text-[9px]">agreement check</span>
          </div>
          <ConsensusMeter segments={state.segments} />
        </section>

        <section className="panel">
          <div className="panel-hd"><span>Departmental Load</span><Activity size={11} /></div>
          <div className="space-y-2.5 p-3.5">
            {state.deptLoad.map((d) => (
              <div key={d.dept}>
                <div className="flex items-center justify-between font-mono text-[9.5px] text-dim">
                  <span style={{ color: DEPT_COLORS[d.dept] }}>{d.dept === "ENG" ? "ENGINEERING · TMS" : d.dept === "TRD" ? "TRACTION · TDMS" : "SIGNAL & TELECOM · SMMS"}</span>
                  <span className="tabular">{d.open} open · {d.critical} crit</span>
                </div>
                <div className="mt-1 flex h-2 gap-0.5 overflow-hidden rounded-full bg-edge">
                  <div className="h-full rounded-l-full transition-all duration-700" style={{ width: `${Math.min(100, d.open * 7)}%`, background: DEPT_COLORS[d.dept], opacity: 0.55 }} />
                  <div className="h-full rounded-r-full transition-all duration-700" style={{ width: `${Math.min(40, d.critical * 8)}%`, background: "#ff4d4f" }} />
                </div>
                <p className="mt-0.5 font-mono text-[8.5px] text-faint">P(fail 72h) {(d.avgFailureProb * 100).toFixed(0)}% — trained model inference</p>
              </div>
            ))}
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2 font-mono text-[8.5px] leading-relaxed text-faint">
              Demo computes scores centrally from the seeded data lake. Production design: departmental agents expose scores over mTLS — contracts documented in the README.
            </div>
          </div>
        </section>

        <section className="panel min-h-[260px]">
          <div className="panel-hd">
            <span className="flex items-center gap-2">Event Spine <span className="anim-blink h-1.5 w-1.5 rounded-full bg-mint" /></span>
            <button onClick={() => setWebhookOpen(true)} className="flex items-center gap-1 rounded border border-cyan/40 bg-cyan/10 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider text-cyan transition hover:bg-cyan/20">
              <Webhook size={9} /> Webhook payload
            </button>
          </div>
          <div className="p-1">
            <LiveFeed events={state.events} />
          </div>
        </section>
      </div>

      {/* Webhook payload modal */}
      {webhookOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-abyss/85 p-4 backdrop-blur-sm" onClick={() => setWebhookOpen(false)}>
          <div className="anim-rise w-full max-w-lg overflow-hidden rounded-2xl border border-cyan/40 bg-hull" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-cyan/30 bg-cyan/[0.07] px-4 py-3">
              <p className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-widest text-cyan"><Webhook size={13} /> Outbound webhook — NTES + SIMRAN</p>
              <span className="rounded bg-amber/15 px-2 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider text-amber">Simulated payload — demo not connected</span>
              <button onClick={() => setWebhookOpen(false)} aria-label="Close webhook payload" className="rounded-lg border border-edge p-1 text-dim hover:text-ink"><X size={14} /></button>
            </div>
            <pre className="overflow-x-auto p-4 font-mono text-[10.5px] leading-relaxed text-mint/90">
{`POST https://ntes.indianrailways.gov.in/api/v2/tsr HTTP/1.1
Authorization: Bearer ••••••••  X-Rakshak-Sign: sha256:9f2c…e1

{
  "TSR": "Speed restriction 30 km/h at Km 4.2 ${firstBlock?.segmentCode ?? "NZM-ANVT"}",
  "Block_ID": "#${firstBlock?.id ?? 5}",
  "Corridor": "${firstBlock?.corridor ?? "DEL-HWH"}",
  "Window": "${firstBlock ? `${fmtMin(firstBlock.startMin)}–${fmtMin(firstBlock.endMin)}` : "00:30–03:10"} IST, Day D+${firstBlock?.day ?? 0}",
  "Departments": ${JSON.stringify(firstBlock?.departments ?? ["ENG", "TRD", "SNT"])},
  "Valid_Till": "${firstBlock ? fmtMin(firstBlock.endMin) : "03:10"} IST",
  "Occupancy": "${firstBlock?.isSuperBlock ? "SUPER_BLOCK_SINGLE_LINE" : "SINGLE_DEPT"}",
  "SIMRAN_Push": "queued",
  "NTES_Recompute": "queued",
  "Issued_By": "RAKSHAK-CORE · autoSigner v3",
  "Audit_Trail": "RR/BLK/2026/000${firstBlock?.id ?? 5}"
}`}
            </pre>
            <p className="border-t border-edge px-4 py-2.5 font-mono text-[8.5px] leading-relaxed text-faint">Exact payload streamed to NTES, SIMRAN loco-pilot tablets and Station Master SMS gateway — zero manual data entry.</p>
          </div>
        </div>
      )}
    </div>
  );
}
