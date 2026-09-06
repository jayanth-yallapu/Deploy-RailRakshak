/**
 * Live train tracking — computes real-time positions for the real train
 * roster along real track waypoint polylines, NTES-style.
 */
import { SEGMENTS, TRAINS, project, type SegmentDef, type TrainDef } from "./network";
import type { LiveTrainDTO } from "./types";

const SEG_BY_CODE = new Map<string, SegmentDef>(SEGMENTS.map((s) => [s.code, s]));

const CRUISE: Record<TrainDef["kind"], number> = {
  RAJDHANI: 105,
  VANDE_BHARAT: 115,
  SHATABDI: 100,
  EXPRESS: 82,
  PASSENGER: 52,
  DFC_FREIGHT: 55,
  RAPIDX: 125,
};

/** Deterministic per-train-per-day delay (stable for the demo, realistic spread). */
export function trainDelayMin(t: TrainDef, date = new Date()): number {
  const seed = t.number.charCodeAt(0) * 13 + t.number.charCodeAt(t.number.length - 1) * 7 + date.getDate();
  if (t.kind === "RAPIDX") return seed % 3;
  if (t.kind === "PASSENGER") return seed % 22;
  if (t.kind === "DFC_FREIGHT") return seed % 15;
  return seed % 14;
}

export interface LegTiming {
  segCode: string;
  from: string;
  to: string;
  enter: number; // relative minutes from actual departure
  exit: number;
}

/** Cumulative per-leg timing, relative to actual (delayed) departure. */
export function legTimings(t: TrainDef): { timings: LegTiming[]; total: number } {
  const speed = CRUISE[t.kind];
  let acc = 0;
  const timings: LegTiming[] = [];
  t.legs.forEach((leg, i) => {
    const seg = SEG_BY_CODE.get(leg.seg);
    if (!seg) return;
    const run = (seg.lengthKm / Math.min(speed, seg.maxSpeed + 15)) * 60 + 1.2; // running + accel
    const enter = acc;
    acc += run;
    const exit = acc;
    timings.push({ segCode: leg.seg, from: leg.from, to: leg.to, enter, exit });
    if (i < t.legs.length - 1) acc += t.kind === "PASSENGER" || t.kind === "RAPIDX" ? 1.0 : 1.6; // dwell
  });
  return { timings, total: acc };
}

/** All runs entering a given section today: [{train, runIdx, enter, exit}] (absolute minutes). */
export function segmentTrainArrivals(segCode: string, date = new Date()) {
  const out: { train: TrainDef; runIdx: number; arr: number; exit: number }[] = [];
  for (const t of TRAINS) {
    if (t.runs === 0) continue;
    const has = t.legs.some((l) => l.seg === segCode);
    if (!has) continue;
    const { timings } = legTimings(t);
    const leg = timings.find((x) => x.segCode === segCode);
    if (!leg) continue;
    const delay = trainDelayMin(t, date);
    const gap = 1440 / t.runs;
    for (let r = 0; r < t.runs; r++) {
      const dep = (t.depMin + r * gap + delay) % 1440;
      out.push({ train: t, runIdx: r, arr: (dep + leg.enter) % 1440, exit: (dep + leg.exit) % 1440 });
    }
  }
  return out;
}

/** Interpolate along a polyline (in projected px) at fraction f. */
function pointAlong(pts: { x: number; y: number }[], f: number) {
  if (pts.length === 0) return { x: 0, y: 0 };
  const lens: number[] = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    lens.push(total);
  }
  const target = f * total;
  for (let i = 1; i < pts.length; i++) {
    if (target <= lens[i]) {
      const segLen = lens[i] - lens[i - 1] || 1;
      const g = (target - lens[i - 1]) / segLen;
      return { x: Math.round((pts[i - 1].x + (pts[i].x - pts[i - 1].x) * g) * 10) / 10, y: Math.round((pts[i - 1].y + (pts[i].y - pts[i - 1].y) * g) * 10) / 10 };
    }
  }
  return pts[pts.length - 1];
}

/** Current state of every train relevant to right now. */
export function getLiveTrains(nowOverride?: number): LiveTrainDTO[] {
  const now = nowOverride ?? new Date().getHours() * 60 + new Date().getMinutes();
  const out: LiveTrainDTO[] = [];
  for (const t of TRAINS) {
    if (t.runs === 0) continue;
    const delay = trainDelayMin(t);
    const gap = 1440 / t.runs;
    const { timings, total } = legTimings(t);
    for (let r = 0; r < t.runs; r++) {
      const dep = (t.depMin + r * gap + delay) % 1440;
      const arr = dep + total;
      if (now < dep - 90 || now > arr + 10) continue;

      let status: LiveTrainDTO["status"] = "SCHEDULED";
      let x = 0;
      let y = 0;
      let segCode: string | null = null;
      let nextStation = t.dest;
      let progressPct = 0;

      if (now >= arr) {
        status = "ARRIVED";
        const lastLeg = timings[timings.length - 1];
        if (lastLeg) {
          const seg = SEG_BY_CODE.get(lastLeg.segCode)!;
          const geo = orient(seg, lastLeg.to);
          const p = pointAlong(geo, 1);
          x = p.x;
          y = p.y;
        }
      } else if (now >= dep) {
        status = "RUNNING";
        const elapsed = now - dep;
        progressPct = Math.min(99, Math.round((elapsed / total) * 100));
        const leg = timings.find((lg) => elapsed >= lg.enter && elapsed < lg.exit);
        if (leg) {
          segCode = leg.segCode;
          nextStation = leg.to;
          const seg = SEG_BY_CODE.get(leg.segCode)!;
          const f = (elapsed - leg.enter) / Math.max(leg.exit - leg.enter, 0.1);
          const geo = orient(seg, leg.to);
          const p = pointAlong(geo, Math.max(0, Math.min(1, f)));
          x = p.x;
          y = p.y;
        } else {
          // dwelling at an intermediate station
          const nextLeg = timings.find((lg) => elapsed < lg.enter);
          const prevLeg = [...timings].reverse().find((lg) => elapsed >= lg.exit);
          const st = nextLeg?.from ?? prevLeg?.to ?? t.origin;
          const seg = SEG_BY_CODE.get((nextLeg ?? prevLeg)!.segCode)!;
          const pt = nextLeg ? geoAt(seg, nextLeg.from) : geoAt(seg, prevLeg!.to);
          x = pt.x;
          y = pt.y;
          nextStation = st;
          segCode = (nextLeg ?? prevLeg)?.segCode ?? null;
          status = "RUNNING";
        }
      } else {
        // not yet departed — position at origin
        const first = timings[0];
        if (first) {
          const seg = SEG_BY_CODE.get(first.segCode)!;
          const pt = geoAt(seg, first.from);
          x = pt.x;
          y = pt.y;
        }
      }

      out.push({
        number: t.number,
        name: t.name,
        kind: t.kind,
        from: t.origin,
        to: t.dest,
        schDep: t.depMin,
        delayMin: delay,
        status,
        segCode,
        progressPct,
        nextStation,
        x: Math.round(x),
        y: Math.round(y),
      });
    }
  }
  return out;
}

function orient(seg: SegmentDef, toward: string): { x: number; y: number }[] {
  const pts = seg.geo.map(([la, ln]) => project(la, ln));
  return seg.to === toward ? pts : [...pts].reverse();
}

function geoAt(seg: SegmentDef, code: string): { x: number; y: number } {
  const idx = seg.from === code ? 0 : seg.geo.length - 1;
  return project(seg.geo[idx][0], seg.geo[idx][1]);
}
