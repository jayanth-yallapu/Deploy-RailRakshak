/**
 * Seed / self-heal for the evaluation data lake.
 *
 * WHY THIS FILE WAS REWRITTEN
 * The previous version inserted 10 hand-written stations with `x: 0, y: 0` and nothing else, and
 * it short-circuited on `if (any station exists) return`. Consequence: the map plotted every
 * station at the origin, there were 0 defects so the optimizer emitted 0 blocks, `/planner`,
 * `/field` and `/jobs` rendered empty, and because the guard passed on the second request the
 * missing data could never appear — the "self-healing seed" was unreachable by construction.
 *
 * NOW
 *  · `network.ts` is the single source of truth for the grid (19 real stations, 23 real sections
 *    with alignment geometry). Map x/y come from `project(lat, lng)` — the same projection
 *    `RailMap.tsx` draws with — so the table and the SVG cannot disagree.
 *  · Assets carry a maintenance cycle (`cycleDays`, `lastInspectedAt`); **overdue maintenance is
 *    derived** from age-vs-cycle instead of being invented (PS requirement 1: "defects, overdue
 *    maintenance").
 *  · Defects carry real `durationMin` / `inspectionMode` / `requiresBlock` / `overdueDays` /
 *    `assetId` — the exact inputs the trained risk model and the wave packer consume.
 *  · Health check gates on the whole lake (grid size, assets, defects, settings keys) and a force
 *    rebuild path exists, so a half-seeded database repairs itself instead of sticking.
 *
 * Deterministic (seeded RNG): the same data, the same plan and the same screenshots on every run,
 * which is what lets the report quote fixed numbers.
 */
import { db } from "@/db";
import { assets, defects, events, jobs, segments, settings, stations } from "@/db/schema";
import { sql } from "drizzle-orm";
import { FIELD_PHOTOS, SEGMENTS, STATIONS, mulberry32, project, sectionMeta } from "./network";
import { numToSeverity } from "./severity";

const DAY_MS = 86_400_000;
const DEMO_SEED = 26027;

/* ------------------------------------------------------------------ */
/*  Defect taxonomy — what each department actually finds in the field */
/* ------------------------------------------------------------------ */

export interface DefectKind {
  title: string;
  note: string;
  /** 1–10 baseline severity; stored as a label, converted via engine/severity.ts. */
  sev: number;
  /** on-site minutes for one crew; drives block length. */
  durationMin: number;
  /** physical = gang must be on the line; virtual/remote = executable without occupying the track. */
  mode: "physical" | "virtual" | "remote";
  requiresBlock: boolean;
  assetType: string;
  /** which system raises it (USFD car, TRC run, SCADA, SMMS telemetry, patroller…). */
  source: string;
  /** inspection/maintenance cycle in days (division norm; editable in production config). */
  cycleDays: number;
}

type Dept = "ENG" | "TRD" | "SNT";

const KINDS: Record<Dept, DefectKind[]> = {
  ENG: [
    { title: "Transverse rail head crack (USFD echo)", note: "Flaw-detection car logged a defect echo; chipping plus alumino-thermic welding of the joint required.", sev: 10, durationMin: 150, mode: "physical", requiresBlock: true, assetType: "RAIL", source: "TMS · USFD car", cycleDays: 30 },
    { title: "Gauge widening beyond +12 mm on curve", note: "TRC geometry run shows gauge spread with cant deficiency at limit; packing and re-alignment due.", sev: 9, durationMin: 120, mode: "physical", requiresBlock: true, assetType: "TRACK_GEOMETRY", source: "TMS · TRC run", cycleDays: 30 },
    { title: "Ballast pumping at formation shoulder", note: "Fines rising through ballast under heavy-load traffic; shoulder and top cleaning required.", sev: 7, durationMin: 90, mode: "physical", requiresBlock: true, assetType: "BALLAST", source: "TMS · SSE patrol", cycleDays: 30 },
    { title: "PSC mono-block sleeper transverse cracks", note: "Sleeper ends rocking; replacement with key tightening on the affected metres.", sev: 6, durationMin: 75, mode: "physical", requiresBlock: true, assetType: "SLEEPER", source: "TMS · patroller report", cycleDays: 45 },
    { title: "Kinks and twists in LWR (destressing pending)", note: "Stress-free temperature not achieved on the renewal reach; slow running imposed at dawn.", sev: 8, durationMin: 135, mode: "physical", requiresBlock: true, assetType: "LWR", source: "TMS · DEN report", cycleDays: 30 },
    { title: "Level-crossing approach slab settled", note: "Ride-quality complaint from road users; re-bedding of approach slab and rubber panel change.", sev: 5, durationMin: 60, mode: "physical", requiresBlock: false, assetType: "LEVEL_CROSSING", source: "TMS · LC register", cycleDays: 60 },
    { title: "Embankment settlement at toe / side trench cutting", note: "Monsoon erosion observed; slope re-grading with picket check before next rain spell.", sev: 4, durationMin: 105, mode: "physical", requiresBlock: false, assetType: "EARTHWORK", source: "TMS · Sr. DEN", cycleDays: 90 },
    { title: "Bridge girder paint blistering (Yamuna span)", note: "Blasting and coal-tar epoxy from the inspection trolley; no line block needed if deck is stable.", sev: 5, durationMin: 180, mode: "physical", requiresBlock: false, assetType: "BRIDGE", source: "TMS · IPC", cycleDays: 365 },
    { title: "Bridge soffit recheck via deck CCTV + drone", note: "Virtual inspection confirming no spalling progression since the last TSR.", sev: 3, durationMin: 25, mode: "virtual", requiresBlock: false, assetType: "BRIDGE", source: "TMS · IPC drone", cycleDays: 90 },
    { title: "TCI trend review after four TRC runs", note: "Desk review of track-confidence-index trend; no gang dispatched while within tolerance.", sev: 2, durationMin: 20, mode: "remote", requiresBlock: false, assetType: "TRACK_GEOMETRY", source: "TMS · analytics", cycleDays: 7 },
  ],
  TRD: [
    { title: "OHE contact-wire height below 5.90 m", note: "Droop measured at the span; messenger re-tensioning and registration adjustment required.", sev: 10, durationMin: 110, mode: "physical", requiresBlock: true, assetType: "OHE_SPAN", source: "TDMS · OGE check car", cycleDays: 15 },
    { title: "Insulator flash-over marks and crazing", note: "25 kV string shows tracking; replacement with shed-type unit during isolation.", sev: 8, durationMin: 70, mode: "physical", requiresBlock: true, assetType: "OHE_MAST", source: "TDMS · SCADA", cycleDays: 15 },
    { title: "OHE mast lean beyond cant tolerance", note: "Cant measured out of limits after girder-lift work; re-plumb and re-tension.", sev: 7, durationMin: 120, mode: "physical", requiresBlock: true, assetType: "OHE_MAST", source: "TDMS · footplate inspection", cycleDays: 15 },
    { title: "Contact-wire wear beyond 30% at tangent", note: "Wear gauge shows thinning; local replacement of contact wire length needed.", sev: 8, durationMin: 95, mode: "physical", requiresBlock: true, assetType: "OHE_SPAN", source: "TDMS · OGE check car", cycleDays: 15 },
    { title: "Rail-bond joint high resistance (return path)", note: "Junction voltage drop above limit; traction return degraded, heating risk on the bond.", sev: 6, durationMin: 45, mode: "physical", requiresBlock: false, assetType: "RETURN_PATH", source: "TDMS · SCADA", cycleDays: 30 },
    { title: "Section insulator to be replaced (3 feeder trips)", note: "Trip history points at the section insulator; swap with isolation and earthing in force.", sev: 9, durationMin: 85, mode: "physical", requiresBlock: true, assetType: "OHE_SWITCHGEAR", source: "TDMS · SCADA", cycleDays: 15 },
    { title: "OHE thermal-rating trend watch (fog load shedding)", note: "No field work; reviewed from SCADA trends and pantograph arc counts.", sev: 2, durationMin: 15, mode: "remote", requiresBlock: false, assetType: "OHE_SPAN", source: "TDMS · analytics", cycleDays: 7 },
  ],
  SNT: [
    { title: "Point machine straining current above limit", note: "3-wire machine drawing high current; mechanism cleaning, packing adjustment and re-wiring check.", sev: 9, durationMin: 70, mode: "physical", requiresBlock: true, assetType: "POINT_MACHINE", source: "SMMS · relay room log", cycleDays: 7 },
    { title: "Approach signal lamp LED module failed", note: "Lamp-out alarm received; module replacement with filament-lamp verification.", sev: 8, durationMin: 40, mode: "physical", requiresBlock: true, assetType: "SIGNAL", source: "SMMS · lamp-out relay", cycleDays: 7 },
    { title: "Axle-counter section reset fault", note: "Counting head intermittent; reset, magnetite check and cable insulation test.", sev: 8, durationMin: 55, mode: "physical", requiresBlock: true, assetType: "AXLE_COUNTER", source: "SMMS · interlock telemetry", cycleDays: 7 },
    { title: "Track-circuit voltage below pick-up", note: "Shunt sensitivity marginal after ballast pumping; clean ballast and re-tune the tuner.", sev: 6, durationMin: 45, mode: "physical", requiresBlock: true, assetType: "TRACK_CIRCUIT", source: "SMMS · tuner log", cycleDays: 14 },
    { title: "LC gate barrier interlock timing out", note: "Gate closing time beyond norm; motor brake adjustment and DTP linkage test.", sev: 7, durationMin: 60, mode: "physical", requiresBlock: false, assetType: "LEVEL_CROSSING", source: "SMMS · DTP sync log", cycleDays: 14 },
    { title: "Signalling cable insulation degradation (run 12)", note: "Megger test shows low insulation; joint re-potting and switch-over to a spare core.", sev: 5, durationMin: 110, mode: "physical", requiresBlock: false, assetType: "CABLE", source: "SMMS · cable test", cycleDays: 90 },
    { title: "Relay-room environment and battery bank check", note: "Temperature, humidity and battery voltage trended from SMMS; no block required.", sev: 3, durationMin: 20, mode: "remote", requiresBlock: false, assetType: "RELAY_ROOM", source: "SMMS · telemetry", cycleDays: 7 },
    { title: "MACLS aspect capture review after signal-drop report", note: "CCTV aspect capture checked against train-pass times before dispatching a gang.", sev: 3, durationMin: 25, mode: "virtual", requiresBlock: false, assetType: "SIGNAL", source: "SMMS · CCTV", cycleDays: 14 },
  ],
};

const DEPTS: Dept[] = ["ENG", "TRD", "SNT"];
const DEPT_SOURCE: Record<Dept, string> = { ENG: "TMS", TRD: "TDMS", SNT: "SMMS" };

const GANGS = [
  "Gang 07 — S. Yadav (Keyman)",
  "Gang 12 — R. Kumar (Keyman)",
  "Gang 03 — M. Bhakar (Keyman)",
  "TRD spot team 2 — A. Prasad",
  "SNT trolley team 1 — K. Meena",
  "ENG KSME-1 — D. Singh",
];

/** Geographic midpoint of a section's real alignment — where the patroller was standing. */
function gpsFor(segCode: string): string {
  const sg = SEGMENTS.find((x) => x.code === segCode);
  if (!sg || sg.geo.length === 0) return "28.6129, 77.2295";
  const mid = sg.geo[Math.floor(sg.geo.length / 2)];
  return `${mid[0].toFixed(5)}, ${mid[1].toFixed(5)}`;
}

/* ------------------------------------------------------------------ */
/*  Lake health check                                                  */
/* ------------------------------------------------------------------ */

interface LakeShape {
  stations: number;
  segments: number;
  assets: number;
  defects: number;
  jobs: number;
  engineSettings: number;
}

async function countOf(table: string, where = ""): Promise<number> {
  const res: any = await db.execute(sql.raw(`select count(*)::int as n from "${table}" ${where}`));
  const row = res?.rows?.[0] ?? res?.[0]?.rows?.[0] ?? res?.[0];
  return Number(row?.n ?? 0);
}

async function lakeShape(): Promise<LakeShape> {
  const [st, sg, a, d, j, cfg] = await Promise.all([
    countOf("stations"),
    countOf("segments"),
    countOf("assets"),
    countOf("defects"),
    countOf("jobs"),
    countOf("settings", `where key in ('fogMode','vipAlert','dtpRedZone')`),
  ]);
  return { stations: st, segments: sg, assets: a, defects: d, jobs: j, engineSettings: cfg };
}

/**
 * Healthy only if the grid matches `network.ts`, there is backlog for the optimizer to schedule,
 * assets exist so health can inform risk, workflow jobs exist so the field pages are not blank,
 * and the settings keys the engine actually reads are present (the old seed wrote `fog_mode` /
 * `vip_corridor`, which nothing looked at — so the fog / VIP / DTP toggles were silent no-ops).
 */
export function isLakeHealthy(s: LakeShape): boolean {
  return (
    s.stations === STATIONS.length &&
    s.segments === SEGMENTS.length &&
    s.assets >= SEGMENTS.length * 3 &&
    s.defects >= 40 &&
    s.jobs >= 8 &&
    s.engineSettings === 3
  );
}

/** Child tables first; `restart identity` keeps ids predictable for the scripted demo. */
async function wipe(): Promise<void> {
  await db.execute(sql.raw(`truncate table "block_items", "plans", "jobs", "defects", "assets", "events", "settings", "segments", "stations" restart identity cascade`));
}

/* ------------------------------------------------------------------ */
/*  Builders                                                           */
/* ------------------------------------------------------------------ */

function buildStations() {
  return STATIONS.map((s) => {
    const { x, y } = project(s.lat, s.lng);
    return {
      code: s.code,
      name: s.name,
      kind: s.kind,
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      lat: s.lat,
      lng: s.lng,
      dailyTrains: s.dailyTrains,
      vipZone: s.vipZone,
    };
  });
}

function buildSegments() {
  return SEGMENTS.map((g) => ({
    code: g.code,
    fromCode: g.from,
    toCode: g.to,
    corridor: g.corridor,
    lengthKm: g.lengthKm,
    isBridge: !!g.isBridge,
    isLevelCrossing: !!g.isLevelCrossing,
    dailyTrains: g.dailyTrains,
    criticality: g.criticality,
    maxSpeed: g.maxSpeed,
  }));
}

interface AssetRow {
  id: number;
  segmentId: number;
  department: string;
  health: number;
  cycleDays: number;
  lastInspectedAt: Date;
}

interface DefectDraft {
  segmentId: number;
  assetId: number;
  department: Dept;
  sourceSystem: string;
  title: string;
  note: string;
  status: "open" | "pending" | "closed";
  severity: string;
  overdueDays: number;
  durationMin: number;
  inspectionMode: string;
  requiresBlock: boolean;
  reportedBy: string;
  gps: string;
  photoPath: string;
  createdAt: Date;
}

/**
 * One to two monitored assets per department per section. Health degrades with the age of the last
 * inspection relative to the cycle, so "degraded asset" and "overdue maintenance" stay coupled.
 */
function buildAssets(segRows: { id: number; code: string }[], rng: () => number) {
  const now = Date.now();
  const out: {
    segmentId: number;
    department: Dept;
    assetType: string;
    label: string;
    health: number;
    sourceSystem: string;
    cycleDays: number;
    lastInspectedAt: Date;
    segCode: string;
    dept: Dept;
    kind: DefectKind;
  }[] = [];

  for (const row of segRows) {
    const def = SEGMENTS.find((s) => s.code === row.code);
    if (!def) continue;
    const perDept = def.lengthKm > 25 ? 2 : 1;
    for (const dept of DEPTS) {
      for (let i = 0; i < perDept; i++) {
        const kinds = KINDS[dept];
        const kind = kinds[(row.id * 3 + i * 5 + def.criticality) % kinds.length];
        const cycle = kind.cycleDays;
        // Most assets are inside cycle; every fifth is materially overdue (that is the backlog).
        const overdueBias = (row.id + i) % 5 === 0 ? 1.85 : 0.9;
        const ageDays = Math.max(1, Math.min(cycle * 2.2, Math.round(cycle * (0.3 + rng() * 1.1) * overdueBias)));
        const health = Math.max(
          22,
          Math.min(99, Math.round(99 - (ageDays / cycle) * 24 - (10 - def.criticality) * 1.3 + (rng() - 0.5) * 8))
        );
        out.push({
          segmentId: row.id,
          department: dept,
          assetType: kind.assetType,
          label: `${row.code} · ${kind.assetType.replace(/_/g, " ")} ${String.fromCharCode(65 + i)}${10 + (def.lengthKm % 40)}`,
          health,
          sourceSystem: DEPT_SOURCE[dept],
          cycleDays: cycle,
          lastInspectedAt: new Date(now - ageDays * DAY_MS),
          segCode: row.code,
          dept,
          kind,
        });
      }
    }
  }
  return out;
}

/**
 * Backlog = (1) overdue-maintenance items derived from age-vs-cycle on every asset, and
 * (2) active defects found on degraded assets, weighted by how poor the health is.
 */
function buildDefects(
  assetRows: (AssetRow & { segCode: string; dept: Dept; kind: DefectKind })[],
  rng: () => number
): DefectDraft[] {
  const now = Date.now();
  const out: DefectDraft[] = [];
  const seen = new Set<string>();

  const mk = (a: AssetRow & { segCode: string; dept: Dept }, kind: DefectKind, overdueDays: number, status: DefectDraft["status"], extra: string): DefectDraft => {
    const healthDrift = a.health < 50 ? 1 : a.health > 90 ? -1 : 0;
    const sev = Math.max(1, Math.min(10, kind.sev + healthDrift + (rng() > 0.84 ? 1 : 0)));
    const photos = FIELD_PHOTOS[a.dept] ?? FIELD_PHOTOS.ENG;
    return {
      segmentId: a.segmentId,
      assetId: a.id,
      department: a.dept,
      sourceSystem: DEPT_SOURCE[a.dept],
      title: kind.title,
      note: `${kind.note} ${extra}`,
      status,
      severity: numToSeverity(sev),
      overdueDays,
      durationMin: kind.durationMin,
      inspectionMode: kind.mode,
      requiresBlock: kind.requiresBlock,
      reportedBy: kind.source,
      gps: gpsFor(a.segCode),
      photoPath: kind.mode === "physical" ? photos.before : "",
      createdAt: new Date(now - Math.round(rng() * 8) * DAY_MS),
    };
  };

  for (const a of assetRows) {
    const ageDays = Math.round((now - a.lastInspectedAt.getTime()) / DAY_MS);
    const overdueDays = Math.max(0, ageDays - a.cycleDays);

    // (1) derived overdue-maintenance item
    if (overdueDays > 0) {
      const key = `${a.id}|overdue`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(mk(a, a.kind, overdueDays, "open", `Overdue by ${overdueDays} d against a ${a.cycleDays} d cycle.`));
      }
    }

    // (2) active defects on this asset, more likely when health is poor
    const pressure = (100 - a.health) / 100 + overdueDays / 90;
    const roll = rng() + pressure;
    const n = roll > 1.28 ? 2 : roll > 0.72 ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const kind = KINDS[a.dept][Math.floor(rng() * KINDS[a.dept].length)];
      const key = `${a.id}|${kind.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const status: DefectDraft["status"] = rng() > 0.78 ? "pending" : "open";
      out.push(mk(a, kind, overdueDays, status, `Asset health ${a.health}%.`));
    }

    // (3) a small cleared history so "closed" status is exercised in the UI
    if (rng() > 0.86) {
      const kind = KINDS[a.dept][(a.id + 1) % KINDS[a.dept].length];
      const key = `${a.id}|${kind.title}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(mk(a, kind, 0, "closed", "Closed after sign-off with after-photo."));
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Workflow jobs — so /field, /jobs and /planner have real state      */
/* ------------------------------------------------------------------ */

async function buildJobs(defectRows: { id: number; segmentId: number | null; department: string; title: string }[], rng: () => number): Promise<number> {
  const segRows = await db.select({ id: segments.id, code: segments.code }).from(segments);
  const codeById = new Map(segRows.map((s) => [s.id, s.code]));
  if (defectRows.length === 0 || segRows.length === 0) return 0;

  const nowM = new Date().getHours() * 60 + new Date().getMinutes();

  /**
   * Status mix chosen so every workflow screen has something real to show, including one live job
   * whose window closes soon — that is what exercises the block-overrun pre-emption path instead
   * of leaving it as dead code only reachable by a lucky demo hour.
   */
  const plan: { status: string; windowAt: number | null; dur: number }[] = [
    { status: "IN_PROGRESS", windowAt: Math.max(35, Math.min(150, nowM - 45)), dur: 120 },
    { status: "IN_PROGRESS", windowAt: 120, dur: 100 },
    { status: "AWAITING_REVIEW", windowAt: 90, dur: 90 },
    { status: "ALLOTTED", windowAt: 165, dur: 110 },
    { status: "ALLOTTED", windowAt: 195, dur: 95 },
    { status: "PENDING", windowAt: null, dur: 90 },
    { status: "PENDING", windowAt: null, dur: 120 },
    { status: "PENDING", windowAt: null, dur: 75 },
    { status: "COMPLETED", windowAt: 70, dur: 105 },
    { status: "COMPLETED", windowAt: 55, dur: 130 },
    { status: "COMPLETED", windowAt: 80, dur: 95 },
    { status: "REJECTED", windowAt: 100, dur: 60 },
  ];

  const values = plan.map((p, i) => {
    const d = defectRows[(i * 11 + 5) % defectRows.length];
    const segmentId = d.segmentId ?? segRows[0].id;
    const code = codeById.get(segmentId) ?? segRows[0].code;
    const meta = sectionMeta(code);
    const dept = (d.department === "TRD" ? "TRD" : d.department === "SNT" ? "SNT" : "ENG") as Dept;
    const photos = FIELD_PHOTOS[dept] ?? FIELD_PHOTOS.ENG;
    const start = p.windowAt ?? 0;
    const touched = p.status !== "PENDING";
    const signed = p.status === "COMPLETED" || p.status === "AWAITING_REVIEW" || p.status === "REJECTED";
    return {
      defectId: d.id,
      segmentId,
      department: dept,
      title: d.title,
      note: `Work order raised from ${DEPT_SOURCE[dept]} backlog · gang of 8 with keyman. ${meta?.jurisdiction ?? ""}`.trim(),
      chainage: meta?.chainage ?? "Km 1450.0 – 1460.0 (chainage ex-DLI)",
      status: p.status,
      teamLeader: p.status === "PENDING" ? null : GANGS[i % GANGS.length],
      windowStart: p.status === "PENDING" ? null : start,
      windowEnd: p.status === "PENDING" ? null : start + p.dur,
      isSuperBlock: i % 4 === 0,
      reportPhoto: photos.before,
      reportGps: gpsFor(code),
      reportAt: new Date(Date.now() - Math.round(rng() * 5 + 1) * DAY_MS),
      beforePhoto: touched ? photos.before : null,
      beforeGps: touched ? gpsFor(code) : null,
      beforeAt: touched ? new Date(Date.now() - 50 * 60_000) : null,
      afterPhoto: signed ? photos.after : null,
      afterGps: signed ? gpsFor(code) : null,
      afterAt: signed ? new Date(Date.now() - 15 * 60_000) : null,
      reviewNote:
        p.status === "COMPLETED"
          ? "Geometry re-checked, ride index within limits. Line reopened for traffic."
          : p.status === "REJECTED"
            ? "After-photo does not match the defect location — work not accepted, re-scheduled."
            : null,
      updatedAt: new Date(Date.now() - Math.round(rng() * 110 + 5) * 60_000),
    };
  });

  await db.insert(jobs).values(values);
  return values.length;
}

async function buildEvents(defectCount: number, jobCount: number, rng: () => number): Promise<void> {
  const msgs: { kind: string; message: string; agoMin: number }[] = [
    { kind: "ai", message: `Data lake reconciled — TMS · TDMS · SMMS backlog normalised: ${defectCount} open items across ${SEGMENTS.length} sections`, agoMin: 4 },
    { kind: "info", message: "COA corridor availability synced: golden window 00:30–04:30 confirmed clear on 18 sections", agoMin: 11 },
    { kind: "warn", message: "Three sections have no block booked this cycle — rotation coverage at risk (PWL-MTJ, DLI-NNO, GZB-MUT)", agoMin: 19 },
    { kind: "critical", message: "USFD echo on NDLS-NZM: transverse rail head crack — 72 h failure probability elevated", agoMin: 26 },
    { kind: "info", message: "FOIS goods forecast ingested: 42 rakes expected via TKD-FDB this cycle", agoMin: 33 },
    { kind: "ai", message: "Risk model retrained at process start; holdout accuracy and AUC published to the Planner model card", agoMin: 41 },
    { kind: "info", message: `${jobCount} field work orders issued to gangs with GPS proximity gate enabled`, agoMin: 55 },
    { kind: "warn", message: "TRD: three feeder trips on section insulator — isolation and earthing mandatory before start", agoMin: 68 },
    { kind: "info", message: "IMD outlook: visibility dip likely in the 03:00–05:00 band for two consecutive nights", agoMin: 77 },
    { kind: "ai", message: `Cross-department agreement ${62 + Math.round(rng() * 30)}% on NZM-ANVT super-block bundling`, agoMin: 88 },
  ];
  await db
    .insert(events)
    .values(msgs.map((m) => ({ kind: m.kind, message: m.message, createdAt: new Date(Date.now() - m.agoMin * 60_000) })));
}

/* ------------------------------------------------------------------ */
/*  Entry points                                                       */
/* ------------------------------------------------------------------ */

let checkedThisProcess = false;

/** Called by every engine read; a no-op once the lake is known good for this process. */
export async function ensureSeeded(force = false): Promise<void> {
  if (checkedThisProcess && !force) return;
  const shape = await lakeShape();
  if (!force && isLakeHealthy(shape)) {
    checkedThisProcess = true;
    return;
  }
  console.log(`[seed] lake incomplete (${JSON.stringify(shape)}) — rebuilding from network.ts grid`);
  await seed();
  checkedThisProcess = true;
}

export async function seed(): Promise<LakeShape> {
  // Serialise rebuilds across processes. Without this, two Next instances (dev + prod, or two
  // replicas) sharing a database can interleave: A truncates, B sees an empty lake and truncates
  // again mid-insert, and both end up with half-written data — a "works alone, breaks together"
  // class of bug that only appears on the demo machine. A session-scoped advisory lock (`pg_advisory_lock`) makes
  // seeding mutually exclusive, and we re-check health right after acquiring it so the loser of the
  // race simply returns instead of rebuilding a lake that is now fine.
  await db.execute(sql`select pg_advisory_lock(hashtext('railrakshak_seed'))`);
  try {
    if (isLakeHealthy(await lakeShape())) {
      await db.execute(sql`select pg_advisory_unlock(hashtext('railrakshak_seed'))`);
      return await lakeShape();
    }
  } catch {
    /* fall through to rebuild */
  }
  try {
    await wipe();
    const rng = mulberry32(DEMO_SEED);

    await db.insert(stations).values(buildStations());
    const segRows = await db.insert(segments).values(buildSegments()).returning({ id: segments.id, code: segments.code });

    const assetDrafts = buildAssets(segRows, rng);
    const assetRows = await db
      .insert(assets)
      .values(
        assetDrafts.map((a) => ({
          segmentId: a.segmentId,
          department: a.department,
          assetType: a.assetType,
          label: a.label,
          health: a.health,
          sourceSystem: a.sourceSystem,
          cycleDays: a.cycleDays,
          lastInspectedAt: a.lastInspectedAt,
        }))
      )
      .returning({
        id: assets.id,
        segmentId: assets.segmentId,
        department: assets.department,
        health: assets.health,
        cycleDays: assets.cycleDays,
        lastInspectedAt: assets.lastInspectedAt,
      });

    const withMeta = assetRows.map((a, i) => ({ ...a, segCode: assetDrafts[i].segCode, dept: assetDrafts[i].dept, kind: assetDrafts[i].kind }));
    const defectDrafts = buildDefects(withMeta, rng);
    const defectRows = await db.insert(defects).values(defectDrafts).returning({ id: defects.id, segmentId: defects.segmentId, department: defects.department, title: defects.title });

    const jobCount = await buildJobs(defectRows, rng);
    await buildEvents(defectDrafts.filter((d) => d.status !== "closed").length, jobCount, rng);

    await db.insert(settings).values([
      { key: "fogMode", value: "false" },
      { key: "vipAlert", value: "false" },
      { key: "dtpRedZone", value: "true" },
      { key: "planStatus", value: "PROPOSED" },
    ]);

    // Publish an opening plan. Without it every dashboard renders "no plan yet" on first paint (and
    // judges who don't click Generate see an empty planner), and state.ts would need invented fallback
    // KPIs. Real divisional practice is that a plan is already live when you walk in.
    try {
      const { runOptimizer } = await import("./optimizer");
      await runOptimizer("WEEKLY");
    } catch (e) {
      console.warn("[seed] opening plan could not be published:", e instanceof Error ? e.message : e);
    }

  } finally {
    await db.execute(sql`select pg_advisory_unlock(hashtext('railrakshak_seed'))`).catch(() => undefined);
  }
  const shape = await lakeShape();
  console.log(`[seed] rebuilt → ${shape.stations} stations · ${shape.segments} sections · ${shape.assets} assets · ${shape.defects} backlog items · ${shape.jobs} work orders`);
  return shape;
}

export { KINDS as DEFECT_KINDS, DEPTS, DEPT_SOURCE };
