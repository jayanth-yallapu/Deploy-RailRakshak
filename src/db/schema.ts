import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  real,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

/** Stations on the REAL Delhi NCR grid — true lat/lng + projected map coords. */
export const stations = pgTable("stations", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("junction"), // terminal | junction | rapidx | halt
  x: real("x").notNull(),
  y: real("y").notNull(),
  lat: real("lat").notNull().default(0),
  lng: real("lng").notNull().default(0),
  dailyTrains: integer("daily_trains").notNull().default(0),
  vipZone: boolean("vip_zone").notNull().default(false),
});

/** Track segments / block sections between stations. */
export const segments = pgTable("segments", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  fromCode: text("from_code").notNull(),
  toCode: text("to_code").notNull(),
  corridor: text("corridor").notNull(), // DEL-HWH | DEL-BCT | DEL-KLK | RING | RRTS | DFC
  lengthKm: real("length_km").notNull(),
  isBridge: boolean("is_bridge").notNull().default(false),
  isLevelCrossing: boolean("is_level_crossing").notNull().default(false),
  dailyTrains: integer("daily_trains").notNull().default(50),
  criticality: integer("criticality").notNull().default(5), // 1..10
  maxSpeed: integer("max_speed").notNull().default(110),
});

/**
 * Fixed assets (track, OHE, signalling) monitored by TMS / TDMS / SMMS.
 *
 * `cycleDays` + `lastInspectedAt` carry the statutory maintenance cycle for the item, which is
 * what lets the system derive **overdue maintenance** (PS requirement 1: "defects, overdue
 * maintenance") instead of inventing an `overdueDays` number: an asset whose age since last
 * inspection exceeds its cycle emits an overdue work item, and the defect inherits that age.
 */
export const assets = pgTable("assets", {
  id: serial("id").primaryKey(),
  segmentId: integer("segment_id")
    .notNull()
    .references(() => segments.id),
  department: text("department").notNull(), // ENG | TRD | SNT
  assetType: text("asset_type").notNull(),
  label: text("label").notNull(),
  health: real("health").notNull().default(80), // 0..100
  sourceSystem: text("source_system").notNull(), // TMS | TDMS | SMMS | ITMS | RDPMS | REMMLOT
  cycleDays: integer("cycle_days").notNull().default(90), // statutory inspection/maintenance cycle
  lastInspectedAt: timestamp("last_inspected_at").notNull().defaultNow(),
});

/**
 * Maintenance backlog: defects raised by patrollers / TMS / TDMS / SMMS plus derived
 * overdue-maintenance items.
 *
 * Field contract (this is the surface every consumer reads — engine, API, four role dashboards):
 *   · `severity` stays a patroller-facing label; `severityToNum()` (engine/severity.ts) is the only
 *     place it becomes a 1–10 number.
 *   · `overdueDays`, `durationMin`, `inspectionMode` and `assetId` are what let the **trained risk
 *     model** and the wave packer run on real data. When these were dropped during an earlier
 *     simplification, the optimizer silently fell back to a hand-written formula and block
 *     durations became a guessed `60 + n*30`; the columns are therefore part of the API contract,
 *     not optional extras.
 *   · 72-h failure probability is deliberately NOT stored — it is model output (`predictRisk`).
 *     Storing it would freeze a stale number and let the DB disagree with the model card.
 *
 * Status vocabulary: open | pending | pending_allotment | allotted | scheduled | closed
 * ("closed" is written by jobs.review on sign-off; "scheduled" by the optimizer on admission).
 */
export const defects = pgTable("defects", {
  id: serial("id").primaryKey(),
  segmentId: integer("segment_id").references(() => segments.id), // null = awaiting section match
  assetId: integer("asset_id").references(() => assets.id), // null = not tied to one asset
  department: text("department").notNull(), // ENG | TRD | SNT
  sourceSystem: text("source_system").notNull().default("TMS"), // TMS | TDMS | SMMS | PATROL
  title: text("title").notNull(),
  note: text("note").notNull().default(""),
  status: text("status").notNull().default("open"),
  severity: text("severity").notNull().default("medium"), // low | medium | high | critical
  overdueDays: integer("overdue_days").notNull().default(0), // age past statutory cycle (assets-derived)
  durationMin: integer("duration_min").notNull().default(60), // on-site minutes, drives block length
  inspectionMode: text("inspection_mode").notNull().default("physical"), // physical | virtual | remote
  requiresBlock: boolean("requires_block").notNull().default(true), // can be done live/without a block?
  reportedBy: text("reported_by"), // USFD car / patroller / SSE / SCADA alarm
  gps: text("gps"), // "lat, lng" from the patroller handset
  photoPath: text("photo_path"), // stored photo URL
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** AI-generated block plans (4H rolling / weekly / monthly / crisis). */
export const plans = pgTable("plans", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  horizon: text("horizon").notNull(), // ROLLING | WEEKLY | MONTHLY | CRISIS
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resilienceScore: real("resilience_score").notNull().default(0),
  kpis: jsonb("kpis").$type<Record<string, number>>().notNull(),
  /** Incremental re-planning: the plan this one replaces, what caused it, and the block-level diff.
   *  A division never re-issues tomorrow's whole schedule at 02:10, so the delta is part of the plan,
   *  not a throwaway response — it is what the "notify affected departments" list is built from. */
  supersedesId: integer("supersedes_id"),
  triggerNote: text("trigger_note"),
  diff: jsonb("diff").$type<Record<string, unknown> | null>(),
});

/** Scheduled maintenance blocks inside a plan. */
export const blockItems = pgTable("block_items", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id")
    .notNull()
    .references(() => plans.id),
  segmentId: integer("segment_id")
    .notNull()
    .references(() => segments.id),
  day: integer("day").notNull().default(0), // day index inside horizon
  startMin: integer("start_min").notNull(), // minutes from 00:00
  endMin: integer("end_min").notNull(),
  departments: jsonb("departments").$type<string[]>().notNull(),
  defectIds: jsonb("defect_ids").$type<number[]>().notNull(),
  isSuperBlock: boolean("is_super_block").notNull().default(false),
  mode: text("mode").notNull().default("physical"), // physical | virtual
  window: text("window").notNull().default("GOLDEN"), // GOLDEN | SHOULDER | OFFPEAK
  delayCostMin: real("delay_cost_min").notNull().default(0),
  status: text("status").notNull().default("proposed"),
  /** Rule evaluation snapshot for this block (see src/lib/engine/policy.ts). Kept on the row so the
   *  Gantt and the approval screen show the same verdict without re-running the rule engine. */
  policy: jsonb("policy").$type<{ score: number; violations: string[]; warnings: string[] } | null>(),
  /** Audit trail for "why this block, here, at this time" — objective terms + the runner-up slot. */
  explain: jsonb("explain").$type<Record<string, unknown> | null>(),
  /** Set only when a human approved a block that carried a hard violation, with the reason. */
  overrideReason: text("override_reason"),
});

/** AI-vs-manual planning benchmark runs: how much better this cycle's plan was, measured. */
export const benchmarks = pgTable("benchmarks", {
  id: serial("id").primaryKey(),
  ranAt: timestamp("ran_at").defaultNow().notNull(),
  horizon: text("horizon").notNull().default("WEEKLY"),
  runs: integer("runs").notNull(),
  seed: integer("seed").notNull().default(1),
  /** Full report (per-run deltas + bootstrap intervals) for the panel and the export. */
  report: jsonb("report").$type<Record<string, unknown>>().notNull(),
});

/** Event / alert feed for the command center. */
export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull().default("info"), // info | warn | critical | ai
  message: text("message").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Key-value operational settings (fog mode, VIP alert, DTP red-zone…). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** 
 * ✅ FIXED: Jobs table – already has the right columns.
 * Kept as-is.
 */
export const jobs = pgTable("jobs", {
  id: serial("id").primaryKey(),
  defectId: integer("defect_id"),
  segmentId: integer("segment_id")
    .notNull()
    .references(() => segments.id),
  department: text("department").notNull(), // ENG | TRD | SNT
  title: text("title").notNull(),
  note: text("note").notNull().default(""),
  chainage: text("chainage").notNull().default(""),
  status: text("status").notNull().default("PENDING"), // PENDING | ALLOTTED | IN_PROGRESS | AWAITING_REVIEW | COMPLETED | REJECTED
  teamLeader: text("team_leader"),
  windowStart: integer("window_start"),
  windowEnd: integer("window_end"),
  isSuperBlock: boolean("is_super_block").notNull().default(false),
  reportPhoto: text("report_photo").notNull().default(""),
  reportGps: text("report_gps").notNull().default(""),
  reportAt: timestamp("report_at").notNull().defaultNow(),
  beforePhoto: text("before_photo"),
  beforeGps: text("before_gps"),
  beforeAt: timestamp("before_at"),
  afterPhoto: text("after_photo"),
  afterGps: text("after_gps"),
  afterAt: timestamp("after_at"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});