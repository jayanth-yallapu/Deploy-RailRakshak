/**
 * Block-policy compliance engine.
 * ---------------------------------------------------------------------------
 * Everything the optimizer *decides* has to survive the rules a block is actually granted under —
 * notified working hours, the maximum occupation a department will be given, protection gaps between
 * parties, single occupancy of a section, the divisional daily budget, VVIP corridor exclusions, the
 * fog standing order, corridor concentration, gang rest. In the manual world these are enforced by a
 * person with a rule book; a plan that ignores them is not a plan, it is a wish.
 *
 * Two design points that matter for trust:
 *
 *  1. The rules are *data*, in one array, each with a `clause` naming where it comes from. A judge
 *     or a divisional officer can read the list and argue with a specific line instead of with a
 *     black box. Tuning a limit is a one-line edit, not a code change.
 *  2. Rules are evaluated against the *stored* plan, from the same rows the Gantt draws, and re-run
 *     after every drag and every settings toggle. So compliance is a live check, not a rubber stamp
 *     that was applied once at generation time: switch on the VVIP alert or fog mode after a plan is
 *     published and the affected blocks light up red immediately.
 *
 * This module is deliberately dependency-free (it takes its limits in `env`) so `optimizer.ts` can
 * import it without creating a cycle — the constants stay defined once, in the optimizer.
 */

export type PolicySeverity = "hard" | "soft";

export interface PolicySegment {
  id: number;
  code: string;
  corridor: string;
  fromCode: string;
  toCode: string;
}

/** The stored shape of a planned occupation — a subset of both DraftBlock and BlockItemDTO. */
export interface PolicyBlock {
  id: number;
  segmentId: number;
  day: number;
  startMin: number;
  endMin: number;
  departments: string[];
  mode: string;
}

export interface PolicyEnv {
  segments: Map<number, PolicySegment> | { get(id: number): PolicySegment | undefined };
  settings: { fogMode: boolean; vipAlert: boolean };
  windows: { name: string; from: number; to: number }[];
  recoveryGapMin: number;
  dailyBudgetMin: number;
  /** Sections touching these stations are excluded while a VVIP movement is notified. */
  vipStations: ReadonlySet<string>;
  /** Dense-fog hours during which a physical gang may not be deployed (fog standing order). */
  fogHours?: { from: number; to: number };
  /** Consecutive nights a department may be out before a rest night is required. */
  maxConsecutiveNights?: number;
  /** Closures allowed on one corridor in one night before the concentration warning fires. */
  maxPerCorridorPerDay?: number;
}

export interface RuleOutcome {
  id: string;
  label: string;
  clause: string;
  severity: PolicySeverity;
  ok: boolean;
  detail: string;
}

export interface BlockPolicy {
  score: number;
  violations: string[];
  warnings: string[];
  results: RuleOutcome[];
}

export interface PlanPolicy {
  score: number;
  compliantBlocks: number;
  hardViolations: number;
  softWarnings: number;
  perBlock: Record<number, BlockPolicy>;
  /** Rule catalogue for the UI — labels and clause text, evaluated once, not per block. */
  rules: { id: string; label: string; clause: string; severity: PolicySeverity }[];
  summary: string;
}

const MAX_BLOCK_MIN: Record<string, number> = { ENG: 210, TRD: 215, SNT: 180 };

/** The longest occupation the rule book permits a set of departments. The solver clamps to this so
 *  it cannot emit a block that its own compliance engine would reject — and both sides read one
 *  number, so the cap cannot be tightened in the rule book while the generator quietly ignores it. */
export function maxBlockMinutes(departments: string[], fallback = 215) {
  return Math.max(...departments.map((d) => MAX_BLOCK_MIN[d] ?? fallback), 45);
}
const DEFAULT_FOG_HOURS = { from: 0, to: 450 }; // 00:00–07:30

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;

interface RuleCtx {
  block: PolicyBlock;
  seg?: PolicySegment;
  sameSectionDay: PolicyBlock[];
  sameCorridorDay: PolicyBlock[];
  sameDay: PolicyBlock[];
  deptDays: Map<string, Set<number>>;
  env: PolicyEnv;
}

interface Rule {
  id: string;
  label: string;
  clause: string;
  severity: PolicySeverity;
  /** Return `true` when satisfied, or a string explaining the breach. */
  check: (c: RuleCtx) => true | string;
  /** Skip the rule entirely when this is false (e.g. VVIP exclusion only applies while notified). */
  applies?: (env: PolicyEnv) => boolean;
}

/** The rule book, as data. */
export const POLICY_RULES: Rule[] = [
  {
    id: "WINDOW",
    label: "Notified working hours",
    clause: "Block work only inside a notified window — the 00:30–05:00 golden block or the 10:30–13:30 shoulder; never into running hours.",
    severity: "hard",
    check: ({ block, env }) => {
      // How far the block would have to move to fit a notified window — the smallest shift over all
      // windows, so the message is actionable rather than just "no".
      let shift = Number.POSITIVE_INFINITY;
      let target: { name: string; from: number; to: number } | null = null;
      for (const w of env.windows) {
        const need = Math.max(0, w.from - block.startMin, block.endMin - w.to);
        if (need < shift) {
          shift = need;
          target = w;
        }
      }
      if (shift === 0) return true;
      const dir = target && block.startMin < target.from ? "later" : "earlier";
      const at =
        target && (block.startMin < target.from ? hhmm(target.from) : hhmm(target.to - (block.endMin - block.startMin)));
      return `${hhmm(block.startMin)}–${hhmm(block.endMin)} falls outside every notified window — it would have to move ${shift} min ${dir} (${target?.name} window, e.g. from ${at}) or run in traffic hours`;
    },
  },
  {
    id: "MAX_BLOCK",
    label: "Maximum occupation per department",
    clause: `A single block may not exceed the longest occupation granted to the department doing it: ${Object.entries(MAX_BLOCK_MIN)
      .map(([d, m]) => `${d} ${m} min`)
      .join(", ")}.`,
    severity: "hard",
    check: ({ block }) => {
      const dur = block.endMin - block.startMin;
      const cap = Math.max(...block.departments.map((d) => MAX_BLOCK_MIN[d] ?? 215), 45);
      const over = dur - cap;
      return over <= 0 ? true : `${dur} min exceeds the ${cap} min standing order by ${over} min`;
    },
  },
  {
    id: "OCCUPANCY",
    label: "Single occupancy of the section",
    clause: "One block party per section per occupation — two crews cannot be signed on to the same running line at once.",
    severity: "hard",
    check: ({ block, sameSectionDay }) => {
      const clash = sameSectionDay.find((o) => o.id !== block.id && overlaps(block.startMin, block.endMin, o.startMin, o.endMin));
      return clash ? `overlaps block #${clash.id} (${hhmm(clash.startMin)}–${hhmm(clash.endMin)}) on the same section` : true;
    },
  },
  {
    id: "GAP",
    label: "Protection gap between parties",
    clause: "Two occupations on the same section need a recovery gap between them for protection, running through and hand-back.",
    severity: "hard",
    check: ({ block, sameSectionDay, env }) => {
      for (const o of sameSectionDay) {
        if (o.id === block.id) continue;
        if (overlaps(block.startMin, block.endMin, o.startMin, o.endMin)) continue; // OCCUPANCY owns that case
        const gap = o.endMin <= block.startMin ? block.startMin - o.endMin : o.startMin - block.endMin;
        if (gap < env.recoveryGapMin) return `only ${gap} min clear of block #${o.id}, needs ${env.recoveryGapMin} min`;
      }
      return true;
    },
  },
  {
    id: "BUDGET",
    label: "Divisional daily occupancy budget",
    clause: "Blocked minutes per night are capped division-wide, so an unplanned incident tomorrow still has a place to go.",
    severity: "hard",
    check: ({ sameDay, env }) => {
      const used = sameDay.reduce((s, b) => s + (b.endMin - b.startMin), 0);
      return used <= env.dailyBudgetMin ? true : `D+${sameDay[0]?.day ?? 0} carries ${used} blocked min, over the ${env.dailyBudgetMin} min budget`;
    },
  },
  {
    id: "VVIP",
    label: "VVIP / exclusive corridor exclusion",
    clause: "While an exclusive movement is notified, no new occupation may be granted on the sections it runs over.",
    severity: "hard",
    applies: (env) => env.settings.vipAlert,
    check: ({ seg, env }) => {
      const vip = env.vipStations;
      const hit = [seg?.fromCode, seg?.toCode].filter((c): c is string => !!c && vip.has(c));
      return hit.length === 0 ? true : `${seg?.code} touches ${hit.join("/")} while the exclusive movement is notified`;
    },
  },
  {
    id: "FOG",
    label: "Fog standing order",
    clause: "In dense fog, physical-gang work inside the fog hours is suspended; only remote/virtual inspection may proceed.",
    severity: "hard",
    applies: (env) => env.settings.fogMode,
    check: ({ block, env }) => {
      const w = env.fogHours ?? DEFAULT_FOG_HOURS;
      const inFogHours = overlaps(block.startMin, block.endMin, w.from, w.to);
      return !(inFogHours && block.mode === "physical")
        ? true
        : `physical party at ${hhmm(block.startMin)} is inside fog hours (${hhmm(w.from)}–${hhmm(w.to)})`;
    },
  },
  {
    id: "CORRIDOR",
    label: "Corridor concentration",
    clause: "Not more than two closures on the same route corridor in one night: a single incident on a bundled corridor must not strand a whole section.",
    severity: "soft",
    check: ({ sameCorridorDay, env }) => {
      const cap = env.maxPerCorridorPerDay ?? 2;
      return sameCorridorDay.length <= cap
        ? true
        : `${sameCorridorDay.length} closures on the same corridor this night (limit ${cap})`;
    },
  },
  {
    id: "REST",
    label: "Weekly rest night for the gang",
    clause: "A department cannot be out on block duty every night of the cycle: one rest night in seven, because fatigue on a live line turns a maintenance job into an accident.",
    severity: "soft",
    check: ({ block, deptDays, env }) => {
      const limit = env.maxConsecutiveNights ?? 6;
      let worst = 0;
      let worstDept = "";
      for (const d of block.departments) {
        const nights = deptDays.get(d) ?? new Set<number>();
        let run = 1;
        for (let k = block.day - 1; nights.has(k); k--) run++;
        for (let k = block.day + 1; nights.has(k); k++) run++;
        if (run > worst) {
          worst = run;
          worstDept = d;
        }
      }
      return worst <= limit ? true : `${worstDept} is deployed ${worst} nights in a row (limit ${limit})`;
    },
  },
];

function evaluateOne(block: PolicyBlock, env: PolicyEnv, index: Map<string, PolicyBlock[]>, deptDays: Map<string, Set<number>>): BlockPolicy {
  const seg = env.segments.get(block.segmentId);
  const sameSectionDay = index.get(`s:${block.segmentId}:${block.day}`) ?? [block];
  const sameCorridorDay = index.get(`c:${seg?.corridor ?? "?"}:${block.day}`) ?? [block];
  const sameDay = index.get(`d:${block.day}`) ?? [block];

  const results: RuleOutcome[] = [];
  for (const r of POLICY_RULES) {
    if (r.applies && !r.applies(env)) continue;
    let out: true | string = true;
    try {
      out = r.check({ block, seg, sameSectionDay, sameCorridorDay, sameDay, deptDays, env });
    } catch (e) {
      // A rule that cannot be evaluated is reported, never silently passed.
      out = `rule could not be evaluated (${String(e).slice(0, 60)})`;
    }
    results.push({ id: r.id, label: r.label, clause: r.clause, severity: r.severity, ok: out === true, detail: out === true ? "satisfied" : out });
  }
  const violations = results.filter((x) => !x.ok && x.severity === "hard").map((x) => `${x.id}: ${x.detail}`);
  const warnings = results.filter((x) => !x.ok && x.severity === "soft").map((x) => `${x.id}: ${x.detail}`);
  const score = Math.max(0, 100 - 34 * violations.length - 9 * warnings.length);
  return { score, violations, warnings, results };
}

/** Evaluate a whole plan against the rule book. Pure: no database, no writes. */
export function evaluatePlanPolicy(blocks: PolicyBlock[], env: PolicyEnv): PlanPolicy {
  const index = new Map<string, PolicyBlock[]>();
  const push = (k: string, b: PolicyBlock) => index.set(k, [...(index.get(k) ?? []), b]);
  for (const b of blocks) {
    push(`s:${b.segmentId}:${b.day}`, b);
    push(`d:${b.day}`, b);
    const cor = (() => {
      const s = env.segments.get(b.segmentId);
      return s?.corridor ?? "?";
    })();
    push(`c:${cor}:${b.day}`, b);
  }

  const deptDays = new Map<string, Set<number>>();
  for (const b of blocks) {
    for (const d of b.departments) {
      const set = deptDays.get(d) ?? new Set<number>();
      set.add(b.day);
      deptDays.set(d, set);
    }
  }

  const perBlock: Record<number, BlockPolicy> = {};
  let hardViolations = 0;
  let softWarnings = 0;
  let compliantBlocks = 0;
  let total = 0;
  for (const b of blocks) {
    const p = evaluateOne(b, env, index, deptDays);
    perBlock[b.id] = p;
    hardViolations += p.violations.length;
    softWarnings += p.warnings.length;
    if (p.violations.length === 0) compliantBlocks += 1;
    total += p.score;
  }
  const score = blocks.length ? Math.round(total / blocks.length) : 100;
  const activeRules = POLICY_RULES.filter((r) => !r.applies || r.applies(env));
  return {
    score,
    compliantBlocks,
    hardViolations,
    softWarnings,
    perBlock,
    rules: activeRules.map((r) => ({ id: r.id, label: r.label, clause: r.clause, severity: r.severity })),
    summary: `${compliantBlocks}/${blocks.length} blocks fully compliant · ${hardViolations} hard violation(s) · ${softWarnings} advisory · policy score ${score}`,
  };
}
