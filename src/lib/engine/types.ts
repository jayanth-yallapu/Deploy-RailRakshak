/** Client-safe DTOs shared between API routes and UI components. */

export type Department = "ENG" | "TRD" | "SNT";

export interface StationDTO {
  id: number;
  code: string;
  name: string;
  kind: string;
  x: number;
  y: number;
  lat: number;
  lng: number;
  dailyTrains: number;
  vipZone: boolean;
}

export interface LiveTrainDTO {
  number: string;
  name: string;
  kind: string;
  from: string;
  to: string;
  schDep: number;
  delayMin: number;
  status: "RUNNING" | "SCHEDULED" | "ARRIVED";
  segCode: string | null;
  progressPct: number;
  nextStation: string;
  x: number;
  y: number;
}

export interface SegmentDTO {
  id: number;
  code: string;
  fromCode: string;
  toCode: string;
  corridor: string;
  lengthKm: number;
  isBridge: boolean;
  isLevelCrossing: boolean;
  dailyTrains: number;
  criticality: number;
}

export interface DefectDTO {
  id: number;
  segmentId: number;
  segmentCode: string;
  department: Department;
  sourceSystem: string;
  title: string;
  severity: number;
  overdueDays: number;
  durationMin: number;
  inspectionMode: string;
  /** false = executable live / without occupying the line (telemetry, CCTV, drone). */
  requiresBlock: boolean;
  /** linked fixed asset (health feeds the risk model); null when not tied to one item. */
  assetId: number | null;
  /** health of that asset, 0–100 (defaults to 80 when there is no asset link). */
  assetHealth: number;
  /** 72-hour probability of failure, 0–1 — direct output of the trained model. */
  failureProb72h: number;
  status: string;
  /** 0–100 prioritisation score (risk + severity + overdue + section exposure). */
  aiScore: number;
}

export interface BlockItemDTO {
  id: number;
  segmentId: number;
  segmentCode: string;
  corridor: string;
  day: number;
  startMin: number;
  endMin: number;
  departments: string[];
  defectCount: number;
  isSuperBlock: boolean;
  mode: string;
  window: string;
  delayCostMin: number;
  /** Rule-engine verdict for this block, recomputed whenever the plan is read. */
  policy?: { score: number; violations: string[]; warnings: string[] } | null;
  overrideReason?: string | null;
  /** Already being executed: copied through a re-plan and refused by the drag endpoint. */
  frozen?: boolean;
  /** Copied through unchanged by an incremental re-plan (stable, but still editable by a human). */
  carried?: boolean;
  frozenReason?: string;
}

export interface PlanDTO {
  id: number;
  name: string;
  horizon: string;
  createdAt: string;
  resilienceScore: number;
  kpis: Record<string, number>;
  /** Plan-level compliance summary (block-policy engine). */
  policy?: {
    score: number;
    compliantBlocks: number;
    hardViolations: number;
    softWarnings: number;
    summary: string;
    rules: { id: string; label: string; clause: string; severity: "hard" | "soft" }[];
  };
  blocks: BlockItemDTO[];
}

export interface EventDTO {
  id: number;
  kind: "info" | "warn" | "critical" | "ai";
  message: string;
  createdAt: string;
}

export interface SettingsDTO {
  fogMode: boolean;
  vipAlert: boolean;
  dtpRedZone: boolean;
  planStatus: "PROPOSED" | "APPROVED" | "VETOED";
}

export type JobStatus = "PENDING" | "ALLOTTED" | "IN_PROGRESS" | "AWAITING_REVIEW" | "COMPLETED" | "REJECTED";

export interface JobDTO {
  id: number;
  defectId: number | null;
  segmentId: number;
  segmentCode: string;
  corridor: string;
  department: Department;
  title: string;
  note: string;
  chainage: string;
  status: JobStatus;
  teamLeader: string | null;
  windowStart: number | null;
  windowEnd: number | null;
  isSuperBlock: boolean;
  reportPhoto: string;
  reportGps: string;
  reportAt: string;
  beforePhoto: string | null;
  beforeGps: string | null;
  beforeAt: string | null;
  afterPhoto: string | null;
  afterGps: string | null;
  afterAt: string | null;
  reviewNote: string | null;
  escalationLevel: number; // 0 none · 1 SMS to karmi · 2 inspector alert · 3 DRM critical
  allottedBy: string | null;
  updatedAt: string;
}

export interface DashboardState {
  stations: StationDTO[];
  segments: SegmentDTO[];
  settings: SettingsDTO;
  counts: {
    openDefects: number;
    criticalDefects: number;
    assetsBelowHealth: number;
    virtualInspections: number;
  };
  deptLoad: { dept: Department; open: number; critical: number; avgFailureProb: number }[];
  latestPlan: PlanDTO | null;
  events: EventDTO[];
  liveTrains: LiveTrainDTO[];
  activeBlockSegments: number[];
  overrun: OverrunInfo | null;
  kpis: {
    downtimeBaselineH: number;
    downtimeOptimizedH: number;
    bundlingPct: number;
    avgDelayMin: number;
    resilienceScore: number;
    conflictsAvoided: number;
    /** Train-minutes of delay, plan vs the sequential-silo baseline — the money figure's only input. */
    delayTrainMin: number;
    baselineDelayTrainMin: number;
  };
  weather: { tempC: number; visibilityM: number; humidityPct: number; fogRisk: string };
  modelCard: {
    algorithm: string;
    trainedOn: number;
    accuracy: number;
    auc: number;
    features: { name: string; weight: number }[];
    note: string;
  };
}

export interface WhatIfRequest {
  segmentId: number;
  durationH: number;
  startMin: number;
  superBlock: boolean;
}

export interface WhatIfResult {
  segmentCode: string;
  affectedTrains: number;
  freightRakesHeld: number;
  totalDelayMin: number;
  passengerDelayCost: number;
  freightPenalty: number;
  dieselSavings: number;
  futureFailureCostAvoided: number;
  netBenefit: number;
  humanImpactScore: number;
  recommend: boolean;
  verdict: string;
  bestWindow: { startMin: number; cost: number };
  stationHeat: Record<string, number>;
  cascade: { station: string; delayMin: number; note: string }[];
}

export interface ConsensusResult {
  segmentCode: string;
  votes: { system: string; dept: Department; vote: number; rationale: string }[];
  agreementPct: number;
  decision: "APPROVED" | "HELD";
  rootCause: string;
}

export interface CrisisStep {
  tSec: number;
  tag: string;
  title: string;
  detail: string;
  tone: "info" | "warn" | "critical" | "ok";
}

export interface CrisisResult {
  scenario: string;
  steps: CrisisStep[];
  decision: {
    action: string;
    rerouteVia: string;
    freightHeld: number;
    costReroute: number;
    costHold: number;
    savings: number;
    blockMin: number;
    justification: string[];
  };
  resolvedInSec: number;
}

export interface SafetyOrderDTO {
  ref: string;
  generatedInMs: number;
  title: string;
  body: string[];
}

export interface OptimizeResponse {
  plan: PlanDTO;
  monteCarlo: { runs: number; p50Delay: number; p95Delay: number; stdDev: number; hist: number[] };
  log: string[];
}

export interface OverrunInfo {
  jobId: number;
  title: string;
  segCode: string;
  remainingMin: number;
  donePct: number;
  probability: number;
}
