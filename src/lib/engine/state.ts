import { db } from "@/db";
import { assets, defects, events, jobs, segments, settings, stations } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { ensureSeeded } from "./seed";
import { getLatestPlan } from "./optimizer";
import { currentWeather } from "./simulate";
import { getLiveTrains } from "./livetrains";
import { scoreDefect, riskFor } from "./optimizer";
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

export async function getDefectDTOs(): Promise<DefectDTO[]> {
  await ensureSeeded();
  const [defectRows, segRows, assetRows, setRow] = await Promise.all([
    db.select().from(defects).orderBy(desc(defects.severity)),
    db.select().from(segments),
    db.select().from(assets),
    getSettings(),
  ]);
  const segById = new Map(segRows.map((s) => [s.id, s]));
  const assetById = new Map(assetRows.map((a) => [a.id, a]));

  return defectRows.map((d) => {
    const asset = assetById.get(d.assetId);
    const seg = asset ? segById.get(asset.segmentId) : null;
    const health = asset?.health ?? 65;
    const prob = seg ? riskFor(d, health, seg, setRow.fogMode) : 0.5;
    const aiScore = seg ? scoreDefect(d, seg, { fogMode: setRow.fogMode, assetHealth: health }) : d.severity * 10;
    return {
      id: d.id,
      segmentId: asset?.segmentId ?? 0,
      segmentCode: seg?.code ?? "?",
      department: d.department as Department,
      sourceSystem: d.sourceSystem,
      title: d.title,
      severity: d.severity,
      overdueDays: d.overdueDays,
      durationMin: d.durationMin,
      inspectionMode: d.inspectionMode,
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
  const [stationRows, segmentRows, settingsRow, defectDTOs, eventsList, latestPlan, allAssets, activeJobs] =
    await Promise.all([
      db.select().from(stations),
      db.select().from(segments),
      getSettings(),
      getDefectDTOs(),
      getEvents(),
      getLatestPlan(),
      db.select().from(assets),
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

  const openDefects = defectDTOs.filter((d) => d.status === "OPEN" || d.status === "open");
  const criticalDefects = openDefects.filter((d) => d.severity >= 8.0);
  const assetsBelowHealth = allAssets.filter((a) => a.health < 50).length;
  const virtualInspections = defectDTOs.filter((d) => d.inspectionMode === "virtual").length;

  const depts: Department[] = ["ENG", "TRD", "SNT"];
  const deptLoad = depts.map((dept) => {
    const dList = openDefects.filter((d) => d.department === dept);
    const avgFail = dList.length ? dList.reduce((acc, d) => acc + d.failureProb72h, 0) / (dList.length * 100) : 0;
    return {
      dept,
      open: dList.length,
      critical: dList.filter((d) => d.severity >= 8.0).length,
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

  const kpis = latestPlan?.kpis ?? {
    downtimeBaselineH: 91.9,
    downtimeOptimizedH: 51.1,
    bundlingPct: 56,
    avgDelayMin: 7.0,
    resilienceScore: 77.8,
    conflictsAvoided: 15,
  };

  return {
    stations: stationsDto,
    segments: segmentsDto,
    settings: settingsRow,
    counts: {
      openDefects: openDefects.length,
      criticalDefects: criticalDefects.length,
      assetsBelowHealth,
      virtualInspections,
    },
    deptLoad,
    latestPlan,
    events: eventsList,
    liveTrains,
    activeBlockSegments,
    overrun,
    kpis: {
      downtimeBaselineH: kpis.downtimeBaselineH ?? 91.9,
      downtimeOptimizedH: kpis.downtimeOptimizedH ?? 51.1,
      bundlingPct: kpis.bundlingPct ?? 56,
      avgDelayMin: kpis.avgDelayMin ?? 7.0,
      resilienceScore: kpis.resilienceScore ?? 77.8,
      conflictsAvoided: kpis.conflictsAvoided ?? 15,
    },
    weather,
    modelCard,
  };
}