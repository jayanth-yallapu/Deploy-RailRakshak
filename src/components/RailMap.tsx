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
  RAJDHANI: "#f59e0b",
  VANDE_BHARAT: "#10b981",
  SHATABDI: "#10b981",
  EXPRESS: "#38bdf8",
  PASSENGER: "#c084fc",
  DFC_FREIGHT: "#f43f5e",
  RAPIDX: "#06b6d4",
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
      style={{ filter: fog ? "saturate(0.6) brightness(0.92)" : undefined }}
      role="img"
      aria-label="Live map of the Delhi NCR railway network"
    >
      <defs>
        <radialGradient id="heatGlow">
          <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.8" />
          <stop offset="60%" stopColor="#f59e0b" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="vipGlow">
          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="yamuna" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#0c1d33" />
          <stop offset="50%" stopColor="#133055" />
          <stop offset="100%" stopColor="#0c1d33" />
        </linearGradient>
        <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <filter id="fogblur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
      </defs>

      {/* Geography Base Layer */}
      {baseLayer && (
        <g>
          {/* NCT Boundary */}
          <path d={nctD} fill="rgba(30, 41, 59, 0.25)" stroke="rgba(71, 85, 105, 0.35)" strokeWidth="1" strokeDasharray="4 6" />
          <text x="306" y="120" fontSize="10" fill="#475569" fontWeight="600" fontFamily="var(--font-sans)" letterSpacing="2">
            NCT DELHI
          </text>

          {/* Expressways */}
          {EXPRESSWAYS.map((e) => (
            <path key={e.name} d={geoPathD(e.geo)} fill="none" stroke="#1e293b" strokeWidth="1.5" strokeDasharray="6 6" opacity="0.9" />
          ))}

          {/* Hindon River */}
          <path d={geoPathD([[28.72, 77.36], [28.66, 77.398], [28.585, 77.42]])} fill="none" stroke="#0f2644" strokeWidth="4" opacity="0.8" />

          {/* Yamuna River */}
          <path d={yamunaD} fill="none" stroke="url(#yamuna)" strokeWidth="14" strokeLinecap="round" opacity="0.95" />
          <path d={yamunaD} fill="none" stroke="#1d4ed8" strokeWidth="1.2" strokeDasharray="8 12" opacity="0.35" className="anim-flow" />
          <path id="yamunaLbl" d={yamunaD} fill="none" stroke="none" />
          <text fontSize="9" fill="#3b82f6" fontWeight="600" opacity="0.75" fontFamily="var(--font-sans)" letterSpacing="2">
            <textPath href="#yamunaLbl" startOffset="38%">YAMUNA RIVER</textPath>
          </text>

          {/* City Nodes */}
          {CITIES.map((c) => {
            const p = project(c.lat, c.lng);
            return (
              <g key={c.name}>
                <circle cx={p.x} cy={p.y} r={c.big ? 2.5 : 1.8} fill="#475569" />
                <text
                  x={p.x + 6}
                  y={p.y + 3}
                  fontSize={c.big ? 10 : 8.5}
                  fill="#64748b"
                  fontFamily="var(--font-sans)"
                  fontWeight={c.big ? 700 : 500}
                >
                  {c.name.toUpperCase()}
                </text>
              </g>
            );
          })}
        </g>
      )}

      {/* Track Segments */}
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
            opacity={dimmed ? 0.15 : 1}
          >
            {/* Click hit area */}
            <path d={d} fill="none" stroke="transparent" strokeWidth="16" />
            <path d={d} fill="none" stroke="#0e1522" strokeWidth={s.corridor === "RRTS" ? 3.5 : 5.5} strokeLinecap="round" strokeLinejoin="round" />
            <path
              d={d}
              fill="none"
              stroke={isBlocked ? "#f43f5e" : color}
              strokeWidth={isSelected ? 3.2 : s.isBridge ? 2.6 : 1.8}
              strokeDasharray={s.corridor === "RRTS" ? "5 7" : isBlocked ? "4 6" : undefined}
              strokeLinecap="round"
              opacity={isBlocked ? 1 : isSelected ? 1 : 0.9}
              className={isBlocked ? "anim-flow" : undefined}
            />
            {isSelected && <path d={d} fill="none" stroke="#f1f5f9" strokeWidth="6" opacity="0.2" filter="url(#soft)" />}
            {isBlocked && <path d={d} fill="none" stroke="#f43f5e" strokeWidth="8" opacity="0.25" filter="url(#soft)" />}
          </g>
        );
      })}

      {/* Bridge Badges */}
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
              <rect
                x={mx - 40}
                y={my - 8}
                width={label.length * 5.4 + 14}
                height="15"
                rx="4"
                fill={isBlocked ? "rgba(244,63,94,0.25)" : "rgba(10,14,23,0.9)"}
                stroke={isBlocked ? "#f43f5e" : "#f59e0b"}
                strokeWidth="0.8"
              />
              <text x={mx - 33} y={my + 3} fontSize="8" fontWeight="600" fill={isBlocked ? "#fb7185" : "#f59e0b"} fontFamily="var(--font-mono)">
                {label}
              </text>
            </g>
          );
        })}

      {/* Station Heatmap */}
      {stations.map((st) => {
        const h = heat[st.code] ?? 0;
        if (h <= 0.02) return null;
        return <circle key={"h" + st.code} cx={st.x} cy={st.y} r={28 + h * 54} fill="url(#heatGlow)" opacity={Math.min(0.85, 0.2 + h)} />;
      })}

      {/* VIP Buffer Radius */}
      {vip &&
        stations
          .filter((s) => s.vipZone)
          .map((st) => (
            <g key={"v" + st.code}>
              <circle cx={st.x} cy={st.y} r={72} fill="url(#vipGlow)" />
              <circle cx={st.x} cy={st.y} r={72} fill="none" stroke="#f59e0b" strokeWidth="1" strokeDasharray="4 8" opacity="0.6" className="anim-flow" />
            </g>
          ))}

      {/* Live Train Indicators */}
      {runningTrains.map((t) => {
        const col = TRAIN_COLORS[t.kind] ?? "#94a3b8";
        const w = t.number.length * 5.4 + 10;
        return (
          <g key={t.number + t.segCode} pointerEvents="none" opacity={fog ? 0.65 : 1}>
            <circle cx={t.x} cy={t.y} r="6" fill={col} opacity="0.3">
              <animate attributeName="r" values="5;9" dur="1.8s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.35;0.05" dur="1.8s" repeatCount="indefinite" />
            </circle>
            <g transform={`translate(${t.x - w / 2}, ${t.y - 19})`}>
              <rect width={w} height="14" rx="4" fill="#0f172a" stroke={col} strokeWidth="1" opacity="0.95" />
              <text x={w / 2} y="10" textAnchor="middle" fontSize="8" fontWeight="700" fill={col} fontFamily="var(--font-mono)">
                {t.number}
              </text>
            </g>
            <circle cx={t.x} cy={t.y} r="3.5" fill={col} stroke="#0f172a" strokeWidth="1.2" />
          </g>
        );
      })}

      {/* Stations */}
      {stations.map((st) => {
        const def = ST_DEFS.find((sd) => sd.code === st.code);
        const big = st.kind === "terminal";
        const isRapidX = st.kind === "rapidx";
        const isHalt = st.kind === "halt";
        return (
          <g key={st.code} opacity={focusStations && !focusStations.has(st.code) ? 0.25 : 1}>
            {st.vipZone && (
              <circle cx={st.x} cy={st.y} r={9} fill="none" stroke="#f59e0b" strokeWidth="1.2" opacity="0.8">
                <animate attributeName="r" values="7;15" dur="2.2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.8;0" dur="2.2s" repeatCount="indefinite" />
              </circle>
            )}
            {isRapidX ? (
              <rect x={st.x - 5} y={st.y - 5} width="10" height="10" fill="#06b6d4" stroke="#0a0e17" strokeWidth="1.5" transform={`rotate(45 ${st.x} ${st.y})`} />
            ) : (
              <circle
                cx={st.x}
                cy={st.y}
                r={big ? 6 : isHalt ? 3.2 : 4.5}
                fill="#131b2a"
                stroke={st.vipZone ? "#f59e0b" : "#e2e8f0"}
                strokeWidth={big ? 2.2 : 1.5}
              />
            )}
            {big && <circle cx={st.x} cy={st.y} r="1.8" fill="#f8fafc" />}
            <text
              x={st.x}
              y={st.y - 10}
              textAnchor="middle"
              fontSize={big ? 12 : isHalt ? 9 : 10}
              fontWeight={big ? 700 : 600}
              fill="#f1f5f9"
              fontFamily="var(--font-sans)"
            >
              {st.code}
            </text>
            <text x={st.x} y={st.y + (isRapidX ? 17 : 15)} textAnchor="middle" fontSize="7.5" fill="#64748b" fontFamily="var(--font-sans)">
              {def?.name ?? ""}
            </text>
          </g>
        );
      })}

      {/* Fog Overlays */}
      {fog && (
        <g filter="url(#fogblur)" pointerEvents="none">
          <ellipse cx="420" cy="300" rx="360" ry="100" fill="#94a3b8" opacity="0.13" className="anim-fog" />
          <ellipse cx="620" cy="480" rx="380" ry="110" fill="#94a3b8" opacity="0.14" className="anim-fog" style={{ animationDelay: "-8s" }} />
          <ellipse cx="760" cy="170" rx="300" ry="80" fill="#94a3b8" opacity="0.12" className="anim-fog" style={{ animationDelay: "-4s" }} />
        </g>
      )}
    </svg>
  );
}

const MemoRailMap = memo(RailMap);
export default MemoRailMap;
