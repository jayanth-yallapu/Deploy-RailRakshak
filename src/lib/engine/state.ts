import { db } from "@/db";
import { defects, events, jobs, segments, settings, stations } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { ensureSeeded } from "./seed";
import { getLatestPlan } from "./optimizer";
import { currentWeather } from "./simulate";
import { getLiveTrains } from "./livetrains";
import { getModelCard } from "./ml";
import type { DashboardState, DefectDTO, EventDTO, OverrunInfo, SettingsDTO, StationDTO, SegmentDTO, Department } from "./types";

export async function getSettings(): Promise<SettingsDTO> {
  await ensureSeeded();
  const rows = await db.select().from(settings);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    fogMode: map.get("fogMode") === "true",
    vipAlert: map.get("vipAlert") === "true",
    dtpRedZone: map.get("dtpRedZone") !== "false",
    planStatus: (map.get("planStatus") as SettingsDTO["planStatus"]) || "PROPOSED",
  };
}

export async function setSetting(
  key: "fogMode" | "vipAlert" | "dtpRedZone" | "planStatus",
  value: boolean | string
): Promise<void> {
  await ensureSeeded();
  await db
    .insert(settings)
    .values({ key, value: String(value) })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: String(value) },
    });
}

/** Map severity text to a 1–10 numeric score */
function severityToNum(s: string): number {
  if (s === "critical") return 10;
  if (s === "high") return 8;
  if (s === "medium") return 5;
  return 2; // low
}

export async function getDefectDTOs(): Promise<DefectDTO[]> {
  await ensureSeeded();
  const [defectRows, segRows] = await Promise.all([
    db.select().from(defects),
    db.select().from(segments),
  ]);
  const segById = new Map(segRows.map((s) => [s.id, s]));

  return defectRows.map((d) => {
    const seg = d.segmentId ? segById.get(d.segmentId) : null;
    const sevNum = severityToNum(d.severity);
    // Simple risk estimate from severity + segment criticality
    const critFactor = seg ? seg.criticality / 10 : 0.5;
    const prob = Math.min(0.99, (sevNum / 10) * 0.6 + critFactor * 0.4);
    const aiScore = Math.round(prob * 100);
    return {
      id: d.id,
      segmentId: d.segmentId ?? 0,
      segmentCode: seg?.code ?? "?",
      department: d.department as Department,
      sourceSystem: d.department === "ENG" ? "TMS" : d.department === "TRD" ? "TDMS" : "SMMS",
      title: d.title,
      severity: sevNum,
      overdueDays: 0,
      durationMin: 60,
      inspectionMode: "physical",
      failureProb72h: Math.round(prob * 100),
      status: d.status,
      aiScore,
    };
  });
}

export async function getDefectDTO(id: number): Promise<DefectDTO | null> {
  const all = await getDefectDTOs();
  return all.find((d) => d.id === id) ?? null;
}

export async function getDefects(): Promise<DefectDTO[]> {
  return getDefectDTOs();
}

export async function getEvents(): Promise<EventDTO[]> {
  await ensureSeeded();
  const rows = await db.select().from(events).orderBy(desc(events.id)).limit(30);
  return rows.map((e) => ({
    id: e.id,
    kind: e.kind as EventDTO["kind"],
    message: e.message,
    createdAt: e.createdAt.toISOString(),
  }));
}

export async function getDashboardState(): Promise<DashboardState> {
  await ensureSeeded();
  const [stationRows, segmentRows, settingsRow, defectDTOs, eventsList, latestPlan, activeJobs] =
    await Promise.all([
      db.select().from(stations),
      db.select().from(segments),
      getSettings(),
      getDefectDTOs(),
      getEvents(),
      getLatestPlan(),
      db.select().from(jobs).where(eq(jobs.status, "IN_PROGRESS")),
    ]);

  const stationsDto: StationDTO[] = stationRows.map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    kind: s.kind,
    x: s.x,
    y: s.y,
    lat: s.lat,
    lng: s.lng,
    dailyTrains: s.dailyTrains,
    vipZone: s.vipZone,
  }));

  const segmentsDto: SegmentDTO[] = segmentRows.map((s) => ({
    id: s.id,
    code: s.code,
    fromCode: s.fromCode,
    toCode: s.toCode,
    corridor: s.corridor,
    lengthKm: s.lengthKm,
    isBridge: s.isBridge,
    isLevelCrossing: s.isLevelCrossing,
    dailyTrains: s.dailyTrains,
    criticality: s.criticality,
  }));

  // Status values used by the new simplified schema
  const openStatuses = new Set(["pending", "open", "pending_allotment", "allotted"]);
  const openDefects = defectDTOs.filter((d) => openStatuses.has(d.status.toLowerCase()));
  const criticalDefects = openDefects.filter((d) => d.severity >= 8);
  const virtualInspections = 0; // no inspectionMode column in new schema

  const depts: Department[] = ["ENG", "TRD", "SNT"];
  const deptLoad = depts.map((dept) => {
    const dList = openDefects.filter((d) => d.department === dept);
    const avgFail = dList.length ? dList.reduce((acc, d) => acc + d.failureProb72h, 0) / (dList.length * 100) : 0;
    return {
      dept,
      open: dList.length,
      critical: dList.filter((d) => d.severity >= 8).length,
      avgFailureProb: Math.round(avgFail * 100) / 100,
    };
  });

  const activeBlockSegments = Array.from(new Set(activeJobs.map((j) => j.segmentId)));
  const segById = new Map(segmentRows.map((s) => [s.id, s]));

  const overrunJob = activeJobs.find((j) => {
    const end = j.windowEnd;
    return end && end < 180;
  });

  const overrun: OverrunInfo | null = overrunJob
    ? {
        jobId: overrunJob.id,
        title: overrunJob.title,
        segCode: segById.get(overrunJob.segmentId)?.code ?? "?",
        remainingMin: 35,
        donePct: 60,
        probability: 0.78,
      }
    : null;

  const liveTrains = getLiveTrains();
  const weather = currentWeather(settingsRow.fogMode);
  const modelCard = getModelCard();

  // Pull KPIs from latestPlan if available, otherwise use sensible defaults
  const planKpis = latestPlan?.kpis ?? {};
  const resilienceScore = latestPlan?.resilienceScore ?? 77.8;

  const kpis = {
    downtimeBaselineH: (planKpis as Record<string, number>).downtimeBaselineH ?? 91.9,
    downtimeOptimizedH: (planKpis as Record<string, number>).downtimeOptimizedH ?? 51.1,
    bundlingPct: (planKpis as Record<string, number>).bundlingPct ?? 56,
    avgDelayMin: (planKpis as Record<string, number>).avgDelayMin ?? 7.0,
    resilienceScore,
    conflictsAvoided: (planKpis as Record<string, number>).conflictsAvoided ?? 15,
  };

  return {
    stations: stationsDto,
    segments: segmentsDto,
    settings: settingsRow,
    counts: {
      openDefects: openDefects.length,
      criticalDefects: criticalDefects.length,
      assetsBelowHealth: 0,
      virtualInspections,
    },
    deptLoad,
    latestPlan,
    events: eventsList,
    liveTrains,
    activeBlockSegments,
    overrun,
    kpis,
    weather,
    modelCard,
  };
}