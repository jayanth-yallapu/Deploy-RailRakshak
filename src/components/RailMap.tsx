"use client";

import { memo, useMemo } from "react";
import {
  CORRIDOR_COLORS,
  EXPRESSWAYS,
  CITIES,
  NCT_GEO,
  YAMUNA_GEO,
  project,
  segmentPathD,
  STATIONS as ST_DEFS,
} from "@/lib/engine/network";
import type { LiveTrainDTO, SegmentDTO, StationDTO } from "@/lib/engine/types";

interface RailMapProps {
  stations: StationDTO[];
  segments: SegmentDTO[];
  heat?: Record<string, number>;
  blockedSegmentIds?: number[];
  fog?: boolean;
  vip?: boolean;
  liveTrains?: LiveTrainDTO[];
  selectedSegment?: string | null;
  onSelectSegment?: (code: string) => void;
  baseLayer?: boolean;
  /** If set, only these section codes render at full brightness (inspector beat focus). */
  dimExcept?: string[];
}

function geoPathD(geo: [number, number][]): string {
  const pts = geo.map(([la, ln]) => project(la, ln));
  if (!pts.length) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x} ${pts[i].y}`;
  return d;
}

const TRAIN_COLORS: Record<string, string> = {
  RAJDHANI: "#ff9f43",
  VANDE_BHARAT: "#7ee787",
  SHATABDI: "#34d399",
  EXPRESS: "#38bdf8",
  PASSENGER: "#c084fc",
  DFC_FREIGHT: "#f43f5e",
  RAPIDX: "#22d3ee",
};

function RailMap({
  stations,
  segments,
  heat = {},
  blockedSegmentIds = [],
  fog = false,
  vip = false,
  liveTrains = [],
  selectedSegment = null,
  onSelectSegment,
  baseLayer = true,
  dimExcept,
}: RailMapProps) {
  const stMap = useMemo(() => new Map(stations.map((s) => [s.code, s])), [stations]);
  const blocked = useMemo(() => new Set(blockedSegmentIds), [blockedSegmentIds]);
  const focus = useMemo(() => (dimExcept ? new Set(dimExcept) : null), [dimExcept]);
  const focusStations = useMemo(() => {
    if (!focus) return null;
    const keep = new Set<string>();
    segments.forEach((sg) => {
      if (focus.has(sg.code)) {
        keep.add(sg.fromCode);
        keep.add(sg.toCode);
      }
    });
    return keep;
  }, [focus, segments]);

  const yamunaD = useMemo(() => geoPathD(YAMUNA_GEO), []);
  const nctD = useMemo(() => geoPathD([...NCT_GEO, NCT_GEO[0]]) + " Z", []);

  const runningTrains = liveTrains.filter((t) => t.status === "RUNNING").slice(0, 14);

  return (
    <svg
      viewBox="0 0 1000 700"
      className="h-auto w-full"
      style={{ filter: fog ? "saturate(0.55) brightness(0.9)" : undefined }}
      role="img"
      aria-label="Live map of the Delhi NCR railway grid — 19 stations, 23 sections, real train positions, Yamuna river and bridge bottlenecks"
    >
      <defs>
        <radialGradient id="heatGlow">
          <stop offset="0%" stopColor="#ff4d4f" stopOpacity="0.85" />
          <stop offset="55%" stopColor="#ff9933" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#ff9933" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="vipGlow">
          <stop offset="0%" stopColor="#f5a524" stopOpacity="0.26" />
          <stop offset="100%" stopColor="#f5a524" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="yamuna" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#0e2a4a" />
          <stop offset="50%" stopColor="#14406e" />
          <stop offset="100%" stopColor="#0e2a4a" />
        </linearGradient>
        <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <filter id="fogblur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="11" />
        </filter>
      </defs>

      {/* ------- real base geography ------- */}
      {baseLayer && (
        <g>
          {/* NCT Delhi boundary */}
          <path d={nctD} fill="rgba(38, 62, 99, 0.16)" stroke="rgba(90, 120, 170, 0.28)" strokeWidth="1" strokeDasharray="3 5" />
          <text x="306" y="120" fontSize="9" fill="#46587a" fontFamily="var(--font-jb)" letterSpacing="3">NCT DELHI</text>

          {/* expressways */}
          {EXPRESSWAYS.map((e) => (
            <path key={e.name} d={geoPathD(e.geo)} fill="none" stroke="#233148" strokeWidth="1.6" strokeDasharray="7 5" opacity="0.8" />
          ))}

          {/* Hindon river (tributary near GZB) */}
          <path d={geoPathD([[28.72, 77.36], [28.66, 77.398], [28.585, 77.42]])} fill="none" stroke="#123154" strokeWidth="4" opacity="0.7" />

          {/* Yamuna river — real course */}
          <path d={yamunaD} fill="none" stroke="url(#yamuna)" strokeWidth="13" strokeLinecap="round" opacity="0.92" />
          <path d={yamunaD} fill="none" stroke="#2b6cb0" strokeWidth="1.2" strokeDasharray="8 12" opacity="0.5" className="anim-flow" />
          <path id="yamunaLbl" d={yamunaD} fill="none" stroke="none" />
          <text fontSize="8.5" fill="#3d6ea6" fontFamily="var(--font-jb)" letterSpacing="3">
            <textPath href="#yamunaLbl" startOffset="38%">YAMUNA RIVER</textPath>
          </text>

          {/* city labels */}
          {CITIES.map((c) => {
            const p = project(c.lat, c.lng);
            return (
              <g key={c.name}>
                <circle cx={p.x} cy={p.y} r={c.big ? 2.6 : 1.8} fill="#3a4c6b" />
                <text x={p.x + 6} y={p.y + 3} fontSize={c.big ? 10 : 8.5} fill="#46587a" fontFamily={c.big ? "var(--font-space)" : "var(--font-jb)"} fontWeight={c.big ? 700 : 400} letterSpacing="1.5">
                  {c.name.toUpperCase()}
                </text>
              </g>
            );
          })}
        </g>
      )}

      {/* ------- real track sections ------- */}
      {segments.map((s) => {
        const d = segmentPathD(s.code);
        if (!d) return null;
        const color = CORRIDOR_COLORS[s.corridor] ?? "#64748b";
        const isBlocked = blocked.has(s.id);
        const isSelected = selectedSegment === s.code;
        const dimmed = focus && !focus.has(s.code);
        return (
          <g
            key={s.code}
            onClick={() => onSelectSegment?.(s.code)}
            style={{ cursor: onSelectSegment ? "pointer" : undefined }}
            opacity={dimmed ? 0.14 : 1}
          >
            {/* fat invisible hit area */}
            <path d={d} fill="none" stroke="transparent" strokeWidth="14" />
            <path d={d} fill="none" stroke="#101a2c" strokeWidth={s.corridor === "RRTS" ? 3.4 : 5.2} strokeLinecap="round" strokeLinejoin="round" />
            <path
              d={d}
              fill="none"
              stroke={isBlocked ? "#ff4d4f" : color}
              strokeWidth={isSelected ? 3.2 : s.isBridge ? 2.6 : 1.8}
              strokeDasharray={s.corridor === "RRTS" ? "5 7" : isBlocked ? "4 6" : undefined}
              strokeLinecap="round"
              opacity={isBlocked ? 0.95 : isSelected ? 1 : 0.88}
              className={isBlocked ? "anim-flow" : undefined}
            />
            {isSelected && <path d={d} fill="none" stroke="#e8eef7" strokeWidth="7" opacity="0.14" filter="url(#soft)" />}
            {isBlocked && <path d={d} fill="none" stroke="#ff4d4f" strokeWidth="9" opacity="0.16" filter="url(#soft)" />}
          </g>
        );
      })}

      {/* ------- bridge markers ------- */}
      {segments
        .filter((s) => s.isBridge)
        .map((s) => {
          const a = stMap.get(s.fromCode);
          const b = stMap.get(s.toCode);
          if (!a || !b) return null;
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          const isBlocked = blocked.has(s.id);
          const label = s.code === "DLI-DSA" ? "OLD YAMUNA BRIDGE" : s.code === "NZM-ANVT" ? "YAMUNA BR #2" : "RRTS BRIDGE";
          return (
            <g key={"br" + s.code} pointerEvents="none">
              <rect x={mx - 40} y={my - 8} width={label.length * 5.4 + 12} height="14" rx="4" fill={isBlocked ? "rgba(255,77,79,0.2)" : "rgba(4,6,12,0.85)"} stroke={isBlocked ? "#ff4d4f" : "#f5a524"} strokeWidth="0.7" />
              <text x={mx - 34 + 6} y={my + 2} fontSize="8" fill={isBlocked ? "#ff9192" : "#f5c66b"} fontFamily="var(--font-jb)">
                {label}
              </text>
            </g>
          );
        })}

      {/* ------- heat overlay ------- */}
      {stations.map((st) => {
        const h = heat[st.code] ?? 0;
        if (h <= 0.02) return null;
        return <circle key={"h" + st.code} cx={st.x} cy={st.y} r={26 + h * 56} fill="url(#heatGlow)" opacity={Math.min(0.9, 0.22 + h)} />;
      })}

      {/* ------- VIP security radius ------- */}
      {vip &&
        stations
          .filter((s) => s.vipZone)
          .map((st) => (
            <g key={"v" + st.code}>
              <circle cx={st.x} cy={st.y} r={70} fill="url(#vipGlow)" />
              <circle cx={st.x} cy={st.y} r={70} fill="none" stroke="#f5a524" strokeWidth="1" strokeDasharray="4 8" opacity="0.6" className="anim-flow" />
            </g>
          ))}

      {/* ------- live train chips (real NTES positions) ------- */}
      {runningTrains.map((t) => {
        const col = TRAIN_COLORS[t.kind] ?? "#94a3b8";
        const w = t.number.length * 5.2 + 8;
        return (
          <g key={t.number + t.segCode} pointerEvents="none" opacity={fog ? 0.6 : 1}>
            <circle cx={t.x} cy={t.y} r="6.5" fill={col} opacity="0.25">
              <animate attributeName="r" values="5;9" dur="1.8s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.35;0.05" dur="1.8s" repeatCount="indefinite" />
            </circle>
            <g transform={`translate(${t.x - w / 2}, ${t.y - 19})`}>
              <rect width={w} height="13" rx="3.5" fill="#04060c" stroke={col} strokeWidth="0.9" opacity="0.95" />
              <text x={w / 2} y="9.4" textAnchor="middle" fontSize="7.5" fontWeight="700" fill={col} fontFamily="var(--font-jb)">
                {t.number}
              </text>
            </g>
            <circle cx={t.x} cy={t.y} r="3.4" fill={col} stroke="#04060c" strokeWidth="1" />
          </g>
        );
      })}

      {/* ------- stations ------- */}
      {stations.map((st) => {
        const def = ST_DEFS.find((sd) => sd.code === st.code);
        const big = st.kind === "terminal";
        const isRapidX = st.kind === "rapidx";
        const isHalt = st.kind === "halt";
        return (
          <g key={st.code} opacity={focusStations && !focusStations.has(st.code) ? 0.25 : 1}>
            {st.vipZone && (
              <circle cx={st.x} cy={st.y} r="9" fill="none" stroke="#f5a524" strokeWidth="1" opacity="0.8">
                <animate attributeName="r" values="7;15" dur="2.2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.8;0" dur="2.2s" repeatCount="indefinite" />
              </circle>
            )}
            {isRapidX ? (
              <rect x={st.x - 5} y={st.y - 5} width="10" height="10" fill="#22d3ee" stroke="#04060c" strokeWidth="1.5" transform={`rotate(45 ${st.x} ${st.y})`} />
            ) : (
              <circle cx={st.x} cy={st.y} r={big ? 6 : isHalt ? 3.2 : 4.4} fill="#0a111e" stroke={st.vipZone ? "#f5a524" : "#dbe6f5"} strokeWidth={big ? 2.2 : 1.5} />
            )}
            {big && <circle cx={st.x} cy={st.y} r="1.8" fill="#e8eef7" />}
            <text
              x={st.x}
              y={st.y - 9}
              textAnchor="middle"
              fontSize={big ? 11.5 : isHalt ? 8.5 : 9.5}
              fontWeight={big ? 700 : 500}
              fill="#e8eef7"
              fontFamily="var(--font-space)"
              style={{ letterSpacing: "0.03em" }}
            >
              {st.code}
            </text>
            <text x={st.x} y={st.y + (isRapidX ? 17 : 15)} textAnchor="middle" fontSize="7.2" fill="#63748f" fontFamily="var(--font-jb)">
              {def?.name ?? ""}
            </text>
          </g>
        );
      })}

      {/* ------- fog overlays ------- */}
      {fog && (
        <g filter="url(#fogblur)" pointerEvents="none">
          <ellipse cx="420" cy="300" rx="360" ry="100" fill="#aebdd4" opacity="0.12" className="anim-fog" />
          <ellipse cx="620" cy="480" rx="380" ry="110" fill="#aebdd4" opacity="0.13" className="anim-fog" style={{ animationDelay: "-8s" }} />
          <ellipse cx="760" cy="170" rx="300" ry="80" fill="#aebdd4" opacity="0.1" className="anim-fog" style={{ animationDelay: "-4s" }} />
        </g>
      )}
    </svg>
  );
}

/** Memoized — the grid only re-renders when its props actually change. */
const MemoRailMap = memo(RailMap);
export default MemoRailMap;
