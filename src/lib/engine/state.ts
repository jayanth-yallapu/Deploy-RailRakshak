import { db } from "@/db";
import { assets, defects, events, jobs, segments, settings, stations } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { ensureSeeded } from "./seed";
import { getLatestPlan } from "./optimizer";
import { currentWeather } from "./simulate";
import { getLiveTrains } from "./livetrains";
import { getModelCard, predictRisk } from "./ml";
import { severityToNum } from "./severity";
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

/**
 * Backlog items as the UI and the optimizer consume them.
 *
 * `failureProb72h` is **model output, 0–1 probability** (PlannerClient renders `prob * 100`%), and
 * `aiScore` is the 0–100 prioritisation score from the same model plus section/asset context. Both
 * are computed here, never stored, so the table can never disagree with the model card. Asset
 * health comes from the linked asset row; `overdueDays`, `durationMin`, `inspectionMode` and
 * `requiresBlock` come from real columns that previously did not exist.
 */
export async function getDefectDTOs(): Promise<DefectDTO[]> {
  await ensureSeeded();
  const [defectRows, segRows, assetRows] = await Promise.all([
    db.select().from(defects),
    db.select().from(segments),
    db.select().from(assets),
  ]);
  const segById = new Map(segRows.map((s) => [s.id, s]));
  const assetById = new Map(assetRows.map((a) => [a.id, a]));
  const fogMode = (await getSettings()).fogMode;

  return defectRows.map((d) => {
    const seg = d.segmentId ? segById.get(d.segmentId) : null;
    const asset = d.assetId ? assetById.get(d.assetId) : null;
    const sevNum = severityToNum(d.severity);
    const health = asset?.health ?? 80;
    const failureProb72h = seg
      ? predictRisk({
          severity: sevNum,
          overdueDays: d.overdueDays,
          assetHealth: health,
          dailyTrains: seg.dailyTrains,
          criticality: seg.criticality,
          isBridge: seg.isBridge,
          fogSeason: fogMode,
        })
      : 0;
    // priority = severity, predicted risk, how overdue, section criticality, traffic exposure
    const aiScore = Math.round(
      0.3 * sevNum * 10 +
        0.3 * failureProb72h * 100 +
        0.12 * Math.min(d.overdueDays / 30, 1) * 100 +
        0.16 * (seg?.criticality ?? 5) * 10 +
        0.12 * Math.min((seg?.dailyTrains ?? 60) / 4, 100) * 1
    );
    return {
      id: d.id,
      segmentId: d.segmentId ?? 0,
      segmentCode: seg?.code ?? "?",
      department: d.department as Department,
      sourceSystem: d.sourceSystem,
      title: d.title,
      severity: sevNum,
      overdueDays: d.overdueDays,
      durationMin: d.durationMin,
      inspectionMode: d.inspectionMode,
      requiresBlock: d.requiresBlock,
      assetId: d.assetId,
      assetHealth: Math.round(health),
      failureProb72h,
      status: d.status,
      aiScore: Math.max(0, Math.min(100, aiScore)),
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
  const [stationRows, segmentRows, settingsRow, defectDTOs, eventsList, latestPlan, activeJobs, assetHealthRows] =
    await Promise.all([
      db.select().from(stations),
      db.select().from(segments),
      getSettings(),
      getDefectDTOs(),
      getEvents(),
      getLatestPlan(),
      db.select().from(jobs).where(eq(jobs.status, "IN_PROGRESS")),
      db.select({ id: assets.id, health: assets.health }).from(assets),
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
  // items executable without occupying the line (CCTV / drone / telemetry) — a real lever for
  // availability, since every one of these is a block that never has to be taken.
  const virtualInspections = openDefects.filter((d) => d.inspectionMode !== "physical" || !d.requiresBlock).length;

  const depts: Department[] = ["ENG", "TRD", "SNT"];
  const deptLoad = depts.map((dept) => {
    const dList = openDefects.filter((d) => d.department === dept);
    const avgFail = dList.length ? dList.reduce((acc, d) => acc + d.failureProb72h, 0) / dList.length : 0;
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

  /**
   * KPIs are read from the published plan — and only from the published plan.
   *
   * There used to be hardcoded fallbacks here (91.9 / 51.1 / 56 / 7.0 / 15 / 77.8) that the UI
   * displayed as if they were measurements whenever no plan existed. Every one of those numbers has
   * been removed: a zero now means "no plan has been generated yet", which is the truth, and the
   * landing page labels it as such instead of quietly inventing a result.
   */
  const planKpis = (latestPlan?.kpis ?? {}) as Record<string, number>;
  const num = (key: string, fallback = 0) => (typeof planKpis[key] === "number" ? planKpis[key] : fallback);

  const kpis = {
    downtimeBaselineH: num("downtimeBaselineH"),
    downtimeOptimizedH: num("downtimeOptimizedH"),
    bundlingPct: num("bundlingPct"),
    avgDelayMin: num("avgDelayMin"),
    resilienceScore: latestPlan?.resilienceScore ?? 0,
    conflictsAvoided: num("conflictsAvoided"),
    delayTrainMin: num("delayTrainMin"),
    baselineDelayTrainMin: num("baselineDelayTrainMin"),
  };

  return {
    stations: stationsDto,
    segments: segmentsDto,
    settings: settingsRow,
    counts: {
      openDefects: openDefects.length,
      criticalDefects: criticalDefects.length,
      assetsBelowHealth: assetHealthRows.filter((a) => a.health < 60).length,
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