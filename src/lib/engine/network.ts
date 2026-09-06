/**
 * REAL Delhi NCR rail grid — true station coordinates (lat/lng) and real
 * track alignments as geographic waypoint polylines. Projection uses a
 * control-room style "core-zoom" transform: maximum fidelity inside the
 * Delhi urban core, compressed margins for NCR outskirts (same approach
 * as divisional ATCS/VDU displays).
 */

export interface StationDef {
  code: string;
  name: string;
  kind: string; // terminal | junction | halt | rapidx
  lat: number;
  lng: number;
  dailyTrains: number;
  vipZone: boolean;
}

export interface SegmentDef {
  code: string;
  from: string;
  to: string;
  corridor: string;
  lengthKm: number;
  isBridge?: boolean;
  isLevelCrossing?: boolean;
  dailyTrains: number;
  criticality: number;
  maxSpeed: number;
  geo: [number, number][]; // [lat,lng] waypoints along the real alignment
}

/* ------------------------------------------------------------------ */
/*  Projection — real coords to SVG space (viewBox 1000x700)           */
/* ------------------------------------------------------------------ */

const CORE = { minLat: 28.55, maxLat: 28.72, minLng: 77.05, maxLng: 77.42 };
const OUTER = { minLat: 28.05, maxLat: 29.42, minLng: 76.93, maxLng: 77.72 };
const BOX = { left: 175, right: 745, top: 165, bottom: 470, w: 1000, h: 700 };

export function project(lat: number, lng: number): { x: number; y: number } {
  let x: number;
  let y: number;
  if (lng < CORE.minLng) {
    x = BOX.left - ((CORE.minLng - lng) / (CORE.minLng - OUTER.minLng)) * BOX.left;
  } else if (lng > CORE.maxLng) {
    x = BOX.right + ((lng - CORE.maxLng) / (OUTER.maxLng - CORE.maxLng)) * (BOX.w - BOX.right);
  } else {
    x = BOX.left + ((lng - CORE.minLng) / (CORE.maxLng - CORE.minLng)) * (BOX.right - BOX.left);
  }
  if (lat > CORE.maxLat) {
    y = BOX.top - ((lat - CORE.maxLat) / (OUTER.maxLat - CORE.maxLat)) * BOX.top;
  } else if (lat < CORE.minLat) {
    y = BOX.bottom + ((CORE.minLat - lat) / (CORE.minLat - OUTER.minLat)) * (BOX.h - BOX.bottom);
  } else {
    y = BOX.top + ((CORE.maxLat - lat) / (CORE.maxLat - CORE.minLat)) * (BOX.bottom - BOX.top);
  }
  // clamp to frame
  x = Math.max(8, Math.min(BOX.w - 8, x));
  y = Math.max(8, Math.min(BOX.h - 8, y));
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

/** Real Yamuna river course through Delhi NCR. */
export const YAMUNA_GEO: [number, number][] = [
  [29.05, 77.235], [28.88, 77.232], [28.80, 77.228], [28.74, 77.233],
  [28.705, 77.241], [28.68, 77.245], [28.665, 77.242], [28.645, 77.249],
  [28.62, 77.258], [28.60, 77.268], [28.575, 77.272], [28.55, 77.282],
  [28.50, 77.3], [28.42, 77.308], [28.3, 77.315], [28.18, 77.318],
];

/** Approximate NCT Delhi boundary (for base-map context). */
export const NCT_GEO: [number, number][] = [
  [28.88, 77.02], [28.87, 77.16], [28.84, 77.28], [28.76, 77.33],
  [28.66, 77.345], [28.56, 77.33], [28.47, 77.29], [28.42, 77.2],
  [28.42, 77.06], [28.5, 76.99], [28.66, 76.975], [28.79, 76.99],
];

/** Real expressways for base-map context (faded). */
export const EXPRESSWAYS: { name: string; geo: [number, number][] }[] = [
  { name: "Delhi–Meerut Expy", geo: [[28.665, 77.265], [28.7, 77.33], [28.78, 77.44], [28.88, 77.56], [28.96, 77.66]] },
  { name: "DND Flyway", geo: [[28.6, 77.27], [28.585, 77.31], [28.57, 77.325]] },
  { name: "Yamuna Expy", geo: [[28.49, 77.315], [28.42, 77.4], [28.38, 77.48]] },
];

export const CITIES: { name: string; lat: number; lng: number; big?: boolean }[] = [
  { name: "Sonipat", lat: 28.99, lng: 77.02 },
  { name: "DELHI", lat: 28.7, lng: 77.185, big: true },
  { name: "Noida", lat: 28.556, lng: 77.342 },
  { name: "Gurugram", lat: 28.455, lng: 77.028 },
  { name: "Faridabad", lat: 28.382, lng: 77.283 },
  { name: "Ghaziabad", lat: 28.695, lng: 77.455 },
  { name: "Meerut", lat: 28.995, lng: 77.705 },
  { name: "Greater Noida", lat: 28.475, lng: 77.505 },
];

/* ------------------------------------------------------------------ */
/*  Real stations                                                      */
/* ------------------------------------------------------------------ */

export const STATIONS: StationDef[] = [
  { code: "PNP", name: "Panipat Jn", kind: "terminal", lat: 29.3872, lng: 76.9641, dailyTrains: 118, vipZone: false },
  { code: "NUR", name: "Narela", kind: "junction", lat: 28.843, lng: 77.0926, dailyTrains: 64, vipZone: false },
  { code: "DLI", name: "Old Delhi Jn", kind: "terminal", lat: 28.6642, lng: 77.2274, dailyTrains: 246, vipZone: true },
  { code: "NDLS", name: "New Delhi", kind: "terminal", lat: 28.6429, lng: 77.2197, dailyTrains: 394, vipZone: true },
  { code: "NZM", name: "Hazrat Nizamuddin", kind: "terminal", lat: 28.5878, lng: 77.254, dailyTrains: 238, vipZone: true },
  { code: "DEE", name: "Delhi Sarai Rohilla", kind: "junction", lat: 28.6645, lng: 77.1865, dailyTrains: 96, vipZone: false },
  { code: "DSJ", name: "Delhi Safdarjung", kind: "halt", lat: 28.592, lng: 77.174, dailyTrains: 72, vipZone: false },
  { code: "DSA", name: "Delhi Shahdara Jn", kind: "junction", lat: 28.673, lng: 77.289, dailyTrains: 112, vipZone: false },
  { code: "ANVT", name: "Anand Vihar Terminal", kind: "terminal", lat: 28.6469, lng: 77.3162, dailyTrains: 128, vipZone: false },
  { code: "SBB", name: "Sahibabad Jn", kind: "junction", lat: 28.672, lng: 77.335, dailyTrains: 104, vipZone: false },
  { code: "GZB", name: "Ghaziabad Jn", kind: "junction", lat: 28.653, lng: 77.4313, dailyTrains: 224, vipZone: false },
  { code: "MUT", name: "Meerut City Jn", kind: "terminal", lat: 28.9787, lng: 77.6946, dailyTrains: 96, vipZone: false },
  { code: "OKA", name: "Okhla", kind: "halt", lat: 28.555, lng: 77.27, dailyTrains: 52, vipZone: false },
  { code: "TKD", name: "Tughlakabad", kind: "junction", lat: 28.5013, lng: 77.268, dailyTrains: 148, vipZone: false },
  { code: "FDB", name: "Faridabad", kind: "junction", lat: 28.403, lng: 77.312, dailyTrains: 132, vipZone: false },
  { code: "PWL", name: "Palwal", kind: "junction", lat: 28.149, lng: 77.325, dailyTrains: 118, vipZone: false },
  { code: "MTJ", name: "Mathura Jn", kind: "terminal", lat: 27.91, lng: 77.579, dailyTrains: 172, vipZone: false },
  { code: "NNO", name: "Nangloi", kind: "halt", lat: 28.6846, lng: 77.0652, dailyTrains: 40, vipZone: false },
  { code: "SKK", name: "Sarai Kale Khan RRTS", kind: "rapidx", lat: 28.5838, lng: 77.2593, dailyTrains: 48, vipZone: false },
];

/* ------------------------------------------------------------------ */
/*  Real track sections (with alignment waypoints)                     */
/* ------------------------------------------------------------------ */

export const SEGMENTS: SegmentDef[] = [
  { code: "PNP-NUR", from: "PNP", to: "NUR", corridor: "DEL-KLK", lengthKm: 44, dailyTrains: 96, criticality: 5, maxSpeed: 110, isLevelCrossing: true, geo: [[29.3872, 76.9641], [29.25, 77.02], [29.05, 77.07], [28.843, 77.0926]] },
  { code: "NUR-DLI", from: "NUR", to: "DLI", corridor: "DEL-KLK", lengthKm: 21, dailyTrains: 108, criticality: 6, maxSpeed: 100, isLevelCrossing: true, geo: [[28.843, 77.0926], [28.775, 77.114], [28.745, 77.142], [28.7, 77.185], [28.6642, 77.2274]] },
  { code: "DLI-NDLS", from: "DLI", to: "NDLS", corridor: "RING", lengthKm: 8.5, dailyTrains: 210, criticality: 9, maxSpeed: 60, geo: [[28.6642, 77.2274], [28.657, 77.2175], [28.648, 77.216], [28.6429, 77.2197]] },
  { code: "NDLS-NZM", from: "NDLS", to: "NZM", corridor: "DEL-BCT", lengthKm: 8, dailyTrains: 322, criticality: 10, maxSpeed: 75, geo: [[28.6429, 77.2197], [28.6352, 77.2215], [28.6265, 77.227], [28.611, 77.2385], [28.598, 77.248], [28.5878, 77.254]] },
  { code: "NZM-ANVT", from: "NZM", to: "ANVT", corridor: "DEL-HWH", lengthKm: 11, dailyTrains: 262, criticality: 10, maxSpeed: 90, isBridge: true, geo: [[28.5878, 77.254], [28.59, 77.2665], [28.609, 77.288], [28.63, 77.306], [28.6469, 77.3162]] },
  { code: "DLI-DSA", from: "DLI", to: "DSA", corridor: "DEL-HWH", lengthKm: 4.5, dailyTrains: 96, criticality: 8, maxSpeed: 45, isBridge: true, geo: [[28.6642, 77.2274], [28.6665, 77.2435], [28.673, 77.289]] },
  { code: "DSA-ANVT", from: "DSA", to: "ANVT", corridor: "DEL-HWH", lengthKm: 3, dailyTrains: 84, criticality: 6, maxSpeed: 60, geo: [[28.673, 77.289], [28.662, 77.3], [28.6469, 77.3162]] },
  { code: "ANVT-SBB", from: "ANVT", to: "SBB", corridor: "DEL-HWH", lengthKm: 6, dailyTrains: 240, criticality: 7, maxSpeed: 90, geo: [[28.6469, 77.3162], [28.662, 77.326], [28.672, 77.335]] },
  { code: "SBB-GZB", from: "SBB", to: "GZB", corridor: "DEL-HWH", lengthKm: 7, dailyTrains: 236, criticality: 7, maxSpeed: 100, geo: [[28.672, 77.335], [28.682, 77.362], [28.668, 77.4], [28.653, 77.4313]] },
  { code: "GZB-MUT", from: "GZB", to: "MUT", corridor: "DEL-HWH", lengthKm: 47, dailyTrains: 96, criticality: 5, maxSpeed: 110, geo: [[28.653, 77.4313], [28.74, 77.49], [28.832, 77.577], [28.9, 77.635], [28.9787, 77.6946]] },
  { code: "NZM-OKA", from: "NZM", to: "OKA", corridor: "DEL-BCT", lengthKm: 3, dailyTrains: 180, criticality: 8, maxSpeed: 75, geo: [[28.5878, 77.254], [28.572, 77.262], [28.555, 77.27]] },
  { code: "OKA-TKD", from: "OKA", to: "TKD", corridor: "DEL-BCT", lengthKm: 6, dailyTrains: 176, criticality: 8, maxSpeed: 90, geo: [[28.555, 77.27], [28.535, 77.269], [28.5013, 77.268]] },
  { code: "TKD-FDB", from: "TKD", to: "FDB", corridor: "DFC", lengthKm: 20, dailyTrains: 132, criticality: 7, maxSpeed: 100, isLevelCrossing: true, geo: [[28.5013, 77.268], [28.475, 77.286], [28.445, 77.3], [28.403, 77.312]] },
  { code: "FDB-PWL", from: "FDB", to: "PWL", corridor: "DEL-BCT", lengthKm: 30, dailyTrains: 120, criticality: 6, maxSpeed: 110, isLevelCrossing: true, geo: [[28.403, 77.312], [28.343, 77.32], [28.245, 77.324], [28.149, 77.325]] },
  { code: "PWL-MTJ", from: "PWL", to: "MTJ", corridor: "DEL-BCT", lengthKm: 36, dailyTrains: 104, criticality: 5, maxSpeed: 110, geo: [[28.149, 77.325], [28.055, 77.36], [27.91, 77.579]] },
  { code: "NZM-DSJ", from: "NZM", to: "DSJ", corridor: "RING", lengthKm: 7, dailyTrains: 62, criticality: 4, maxSpeed: 60, geo: [[28.5878, 77.254], [28.5675, 77.243], [28.5728, 77.2176], [28.5775, 77.209], [28.592, 77.174]] },
  { code: "DSJ-DEE", from: "DSJ", to: "DEE", corridor: "RING", lengthKm: 7, dailyTrains: 58, criticality: 4, maxSpeed: 60, geo: [[28.592, 77.174], [28.605, 77.156], [28.638, 77.162], [28.6645, 77.1865]] },
  { code: "DEE-DLI", from: "DEE", to: "DLI", corridor: "RING", lengthKm: 4.5, dailyTrains: 54, criticality: 4, maxSpeed: 60, geo: [[28.6645, 77.1865], [28.669, 77.203], [28.6642, 77.2274]] },
  { code: "DLI-NNO", from: "DLI", to: "NNO", corridor: "DEL-ROK", lengthKm: 13, dailyTrains: 44, criticality: 3, maxSpeed: 75, isLevelCrossing: true, geo: [[28.6642, 77.2274], [28.684, 77.165], [28.686, 77.12], [28.6846, 77.0652]] },
  { code: "XR:SKK-ANVT", from: "SKK", to: "ANVT", corridor: "RRTS", lengthKm: 9, dailyTrains: 48, criticality: 5, maxSpeed: 160, isBridge: true, geo: [[28.5838, 77.2593], [28.596, 77.276], [28.626, 77.3], [28.6469, 77.3162]] },
  { code: "XR:ANVT-SBB", from: "ANVT", to: "SBB", corridor: "RRTS", lengthKm: 7, dailyTrains: 48, criticality: 5, maxSpeed: 160, geo: [[28.6469, 77.3162], [28.66, 77.329], [28.672, 77.335]] },
  { code: "XR:SBB-GZB", from: "SBB", to: "GZB", corridor: "RRTS", lengthKm: 8, dailyTrains: 48, criticality: 5, maxSpeed: 160, geo: [[28.672, 77.335], [28.67, 77.372], [28.658, 77.41], [28.653, 77.4313]] },
  { code: "XR:GZB-MUT", from: "GZB", to: "MUT", corridor: "RRTS", lengthKm: 42, dailyTrains: 48, criticality: 4, maxSpeed: 160, geo: [[28.653, 77.4313], [28.735, 77.52], [28.86, 77.61], [28.9787, 77.6946]] },
];

/* ------------------------------------------------------------------ */
/*  Traffic model                                                      */
/* ------------------------------------------------------------------ */

export function trafficFactor(min: number): number {
  if (min <= 270) return 0.06; // golden window 00:00–04:30
  if (min >= 360 && min <= 600) return 1.0; // morning peak 06:00–10:00
  if (min >= 630 && min <= 810) return 0.28; // mid-day shoulder
  if (min >= 1020 && min <= 1260) return 0.9; // evening peak 17:00–21:00
  if (min >= 1260) return 0.3;
  return 0.4;
}

export const DTP_RED_ZONES: [number, number][] = [
  [480, 660], // 08:00 – 11:00
  [1050, 1230], // 17:30 – 20:30
];

/* ------------------------------------------------------------------ */
/*  REAL train roster — real numbers, names, schedules                 */
/* ------------------------------------------------------------------ */

export interface TrainLeg {
  seg: string;
  from: string;
  to: string;
}

export interface TrainDef {
  number: string;
  name: string;
  kind: "RAJDHANI" | "VANDE_BHARAT" | "SHATABDI" | "EXPRESS" | "PASSENGER" | "DFC_FREIGHT" | "RAPIDX";
  origin: string;
  dest: string;
  legs: TrainLeg[];
  depMin: number; // scheduled departure from origin (minutes from 00:00 IST)
  runs: number; // runs per day (locals/RRTS run many)
  priority: number;
  pax: number;
}

const L = (seg: string, from: string, to: string): TrainLeg => ({ seg, from, to });

export const TRAINS: TrainDef[] = [
  {
    number: "12951", name: "Mumbai Rajdhani", kind: "RAJDHANI", origin: "NDLS", dest: "MMCT", depMin: 16 * 60 + 25, runs: 1, priority: 9, pax: 1216,
    legs: [L("NDLS-NZM", "NDLS", "NZM"), L("NZM-OKA", "NZM", "OKA"), L("OKA-TKD", "OKA", "TKD"), L("TKD-FDB", "TKD", "FDB"), L("FDB-PWL", "FDB", "PWL")],
  },
  {
    number: "12952", name: "Mumbai Rajdhani", kind: "RAJDHANI", origin: "PWL", dest: "NDLS", depMin: 6 * 60 + 5, runs: 1, priority: 9, pax: 1184,
    legs: [L("FDB-PWL", "PWL", "FDB"), L("TKD-FDB", "FDB", "TKD"), L("OKA-TKD", "TKD", "OKA"), L("NZM-OKA", "OKA", "NZM"), L("NDLS-NZM", "NZM", "NDLS")],
  },
  {
    number: "12301", name: "Howrah Rajdhani", kind: "RAJDHANI", origin: "NDLS", dest: "HWH", depMin: 16 * 60 + 55, runs: 1, priority: 9, pax: 1180,
    legs: [L("NDLS-NZM", "NDLS", "NZM"), L("NZM-ANVT", "NZM", "ANVT"), L("ANVT-SBB", "ANVT", "SBB"), L("SBB-GZB", "SBB", "GZB")],
  },
  {
    number: "12302", name: "Howrah Rajdhani", kind: "RAJDHANI", origin: "GZB", dest: "NDLS", depMin: 5 * 60 + 50, runs: 1, priority: 9, pax: 1152,
    legs: [L("SBB-GZB", "GZB", "SBB"), L("ANVT-SBB", "SBB", "ANVT"), L("NZM-ANVT", "ANVT", "NZM"), L("NDLS-NZM", "NZM", "NDLS")],
  },
  {
    number: "12423", name: "Dibrugarh Rajdhani", kind: "RAJDHANI", origin: "NDLS", dest: "DBRG", depMin: 16 * 60 + 20, runs: 1, priority: 9, pax: 1076,
    legs: [L("NDLS-NZM", "NDLS", "NZM"), L("NZM-ANVT", "NZM", "ANVT"), L("ANVT-SBB", "ANVT", "SBB"), L("SBB-GZB", "SBB", "GZB")],
  },
  {
    number: "12002", name: "Bhopal Shatabdi", kind: "SHATABDI", origin: "NDLS", dest: "RKM", depMin: 6 * 60, runs: 1, priority: 8, pax: 904,
    legs: [L("NDLS-NZM", "NDLS", "NZM"), L("NZM-OKA", "NZM", "OKA"), L("OKA-TKD", "OKA", "TKD"), L("TKD-FDB", "TKD", "FDB")],
  },
  {
    number: "22439", name: "Vande Bharat Exp", kind: "VANDE_BHARAT", origin: "NDLS", dest: "SVDK", depMin: 6 * 60, runs: 1, priority: 9, pax: 1040,
    legs: [L("DLI-NDLS", "NDLS", "DLI"), L("NUR-DLI", "DLI", "NUR"), L("PNP-NUR", "NUR", "PNP")],
  },
  {
    number: "12005", name: "Kalka Shatabdi", kind: "SHATABDI", origin: "NDLS", dest: "KLK", depMin: 17 * 60 + 15, runs: 1, priority: 8, pax: 876,
    legs: [L("DLI-NDLS", "NDLS", "DLI"), L("NUR-DLI", "DLI", "NUR"), L("PNP-NUR", "NUR", "PNP")],
  },
  {
    number: "12279", name: "Taj Express", kind: "EXPRESS", origin: "NDLS", dest: "VGLJ", depMin: 7 * 60 + 10, runs: 1, priority: 7, pax: 1120,
    legs: [L("NDLS-NZM", "NDLS", "NZM"), L("NZM-OKA", "NZM", "OKA"), L("OKA-TKD", "OKA", "TKD"), L("TKD-FDB", "TKD", "FDB"), L("FDB-PWL", "FDB", "PWL")],
  },
  {
    number: "12033", name: "Kanpur Shatabdi", kind: "SHATABDI", origin: "NDLS", dest: "CNB", depMin: 15 * 60 + 20, runs: 1, priority: 8, pax: 892,
    legs: [L("NDLS-NZM", "NDLS", "NZM"), L("NZM-ANVT", "NZM", "ANVT"), L("ANVT-SBB", "ANVT", "SBB"), L("SBB-GZB", "SBB", "GZB")],
  },
  {
    number: "12401", name: "Magadh Express", kind: "EXPRESS", origin: "NDLS", dest: "IPR", depMin: 20 * 60, runs: 1, priority: 6, pax: 1380,
    legs: [L("NDLS-NZM", "NDLS", "NZM"), L("NZM-ANVT", "NZM", "ANVT"), L("ANVT-SBB", "ANVT", "SBB"), L("SBB-GZB", "SBB", "GZB")],
  },
  {
    number: "12505", name: "North East Exp", kind: "EXPRESS", origin: "ANVT", dest: "KNE", depMin: 7 * 60 + 40, runs: 1, priority: 6, pax: 1290,
    legs: [L("ANVT-SBB", "ANVT", "SBB"), L("SBB-GZB", "SBB", "GZB"), L("GZB-MUT", "GZB", "MUT")],
  },
  {
    number: "12919", name: "Malwa Express", kind: "EXPRESS", origin: "PWL", dest: "NDLS", depMin: 5 * 60 + 15, runs: 1, priority: 6, pax: 1260,
    legs: [L("FDB-PWL", "PWL", "FDB"), L("TKD-FDB", "FDB", "TKD"), L("OKA-TKD", "TKD", "OKA"), L("NZM-OKA", "OKA", "NZM"), L("NDLS-NZM", "NZM", "NDLS")],
  },
  {
    number: "11078", name: "Jhelum Express", kind: "EXPRESS", origin: "PNP", dest: "DLI", depMin: 8 * 60 + 15, runs: 1, priority: 6, pax: 1150,
    legs: [L("PNP-NUR", "PNP", "NUR"), L("NUR-DLI", "NUR", "DLI")],
  },
  {
    number: "DFCL-9001", name: "DFC Super Heavy 10.2kT", kind: "DFC_FREIGHT", origin: "GZB", dest: "MTJ", depMin: 2 * 60 + 35, runs: 3, priority: 7, pax: 0,
    legs: [L("SBB-GZB", "GZB", "SBB"), L("ANVT-SBB", "SBB", "ANVT"), L("NZM-ANVT", "ANVT", "NZM"), L("NZM-OKA", "NZM", "OKA"), L("OKA-TKD", "OKA", "TKD"), L("TKD-FDB", "TKD", "FDB"), L("FDB-PWL", "FDB", "PWL"), L("PWL-MTJ", "PWL", "MTJ")],
  },
  {
    number: "DFCL-7745", name: "DFC Container West", kind: "DFC_FREIGHT", origin: "TKD", dest: "PWL", depMin: 3 * 60 + 50, runs: 4, priority: 6, pax: 0,
    legs: [L("TKD-FDB", "TKD", "FDB"), L("FDB-PWL", "FDB", "PWL")],
  },
  {
    number: "DFCL-5521", name: "DFC Coal Rake", kind: "DFC_FREIGHT", origin: "PWL", dest: "TKD", depMin: 11 * 60 + 25, runs: 3, priority: 6, pax: 0,
    legs: [L("FDB-PWL", "PWL", "FDB"), L("TKD-FDB", "FDB", "TKD")],
  },
  {
    number: "64491", name: "Ghaziabad–NDLS MEMU", kind: "PASSENGER", origin: "GZB", dest: "NDLS", depMin: 7 * 60 + 35, runs: 6, priority: 4, pax: 2100,
    legs: [L("SBB-GZB", "GZB", "SBB"), L("ANVT-SBB", "SBB", "ANVT"), L("NZM-ANVT", "ANVT", "NZM"), L("NDLS-NZM", "NZM", "NDLS")],
  },
  {
    number: "64060", name: "Palwal–NDLS EMU", kind: "PASSENGER", origin: "PWL", dest: "NDLS", depMin: 6 * 60 + 12, runs: 5, priority: 4, pax: 2400,
    legs: [L("FDB-PWL", "PWL", "FDB"), L("TKD-FDB", "FDB", "TKD"), L("OKA-TKD", "TKD", "OKA"), L("NZM-OKA", "OKA", "NZM"), L("NDLS-NZM", "NZM", "NDLS")],
  },
  {
    number: "64093", name: "Ring Railway EMU", kind: "PASSENGER", origin: "NDLS", dest: "NDLS", depMin: 9 * 60 + 5, runs: 8, priority: 4, pax: 1850,
    legs: [L("NDLS-NZM", "NDLS", "NZM"), L("NZM-DSJ", "NZM", "DSJ"), L("DSJ-DEE", "DSJ", "DEE"), L("DEE-DLI", "DEE", "DLI"), L("DLI-NDLS", "DLI", "NDLS")],
  },
  {
    number: "64016", name: "Nangloi–DLI EMU", kind: "PASSENGER", origin: "NNO", dest: "DLI", depMin: 6 * 60 + 47, runs: 6, priority: 4, pax: 1600,
    legs: [L("DLI-NNO", "NNO", "DLI")],
  },
  {
    number: "NB-101", name: "Namo Bharat RRTS", kind: "RAPIDX", origin: "SKK", dest: "MUT", depMin: 6 * 60, runs: 18, priority: 5, pax: 1500,
    legs: [L("XR:SKK-ANVT", "SKK", "ANVT"), L("XR:ANVT-SBB", "ANVT", "SBB"), L("XR:SBB-GZB", "SBB", "GZB"), L("XR:GZB-MUT", "GZB", "MUT")],
  },
  {
    number: "NB-102", name: "Namo Bharat RRTS", kind: "RAPIDX", origin: "MUT", dest: "SKK", depMin: 6 * 60 + 10, runs: 18, priority: 5, pax: 1500,
    legs: [L("XR:GZB-MUT", "MUT", "GZB"), L("XR:SBB-GZB", "GZB", "SBB"), L("XR:ANVT-SBB", "SBB", "ANVT"), L("XR:SKK-ANVT", "ANVT", "SKK")],
  },
  {
    number: "VVIP-001", name: "VVIP Special (NR)", kind: "EXPRESS", origin: "NDLS", dest: "DLI", depMin: 0, runs: 0, priority: 10, pax: 60,
    legs: [L("DLI-NDLS", "NDLS", "DLI")],
  },
];

/* ------------------------------------------------------------------ */
/*  Cost model, colors, misc                                           */
/* ------------------------------------------------------------------ */

export const COST = {
  paxDelayPerMin: 420,
  freightHoldPerMin: 950,
  dieselIdlePerMin: 260,
  emergencyBlockPerMin: 5400,
  plannedBlockPerMin: 1100,
};

export const CORRIDOR_COLORS: Record<string, string> = {
  "DEL-HWH": "#ff9f43",
  "DEL-BCT": "#38bdf8",
  "DEL-KLK": "#7ee787",
  RING: "#c084fc",
  "DEL-ROK": "#d4b483",
  RRTS: "#22d3ee",
  DFC: "#f43f5e",
};

export const DEPT_COLORS: Record<string, string> = {
  ENG: "#f5a524",
  TRD: "#38bdf8",
  SNT: "#a78bfa",
};

export const DEPT_NAMES: Record<string, string> = {
  ENG: "Engineering (TMS)",
  TRD: "Traction (TDMS)",
  SNT: "Signal & Telecom (SMMS)",
};

export function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fmtMin(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Path d-builder for a segment's real alignment in SVG space. */
export function segmentPathD(code: string): string {
  const seg = SEGMENTS.find((s) => s.code === code);
  if (!seg) return "";
  const pts = seg.geo.map(([la, ln]) => project(la, ln));
  if (pts.length === 0) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x} ${pts[i].y}`;
  return d;
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100000;
  return h;
}

/** Karmi team leaders per department (real field-crew naming). */
export const KARMI_TEAMS: Record<string, { id: string; leader: string; exp: string; crew: number }[]> = {
  ENG: [
    { id: "ENG-G7", leader: "Ramesh Kumar", exp: "12 yr · P.Way gang", crew: 8 },
    { id: "ENG-G12", leader: "Surendra Yadav", exp: "8 yr · USFD certified", crew: 6 },
    { id: "ENG-ATW3", leader: "Prakash Mishra", exp: "15 yr · AT welding unit", crew: 5 },
  ],
  TRD: [
    { id: "TRD-OHE5", leader: "Dinesh Singh", exp: "10 yr · OHE maintenance", crew: 6 },
    { id: "TRD-PSI2", leader: "Farooq Ahmed", exp: "9 yr · PSI & switching", crew: 4 },
  ],
  SNT: [
    { id: "SNT-S4", leader: "Meena Gupta", exp: "11 yr · signalling", crew: 5 },
    { id: "SNT-TC1", leader: "Bhupesh Kumar", exp: "7 yr · track circuits", crew: 4 },
  ],
};

/** Section Inspector's assigned beat. */
export const INSPECTOR_ZONE = {
  name: "NDLS Beat — SSE/P.Way/NDLS-I",
  sections: ["DLI-NDLS", "NDLS-NZM", "NZM-ANVT", "NZM-OKA"],
};

/** Canonical field photos per department (before/after repair). */
export const FIELD_PHOTOS: Record<string, { before: string; after: string }> = {
  ENG: { before: "/photos/rail-crack-before.jpg", after: "/photos/rail-weld-after.jpg" },
  TRD: { before: "/photos/insulator-before.jpg", after: "/photos/insulator-after.jpg" },
  SNT: { before: "/photos/signal-before.jpg", after: "/photos/signal-after.jpg" },
};

/** Realistic railway jurisdiction / engineering detail per section. */
export function sectionMeta(code: string) {
  const seg = SEGMENTS.find((s) => s.code === code);
  if (!seg) return null;
  const h = hashStr(code);
  const baseKm = 1350 + (h % 260);
  const lineRef =
    seg.corridor === "DEL-HWH" ? "(chainage ex-HWH)" : seg.corridor === "DEL-BCT" ? "(chainage ex-MMCT)" : seg.corridor === "DEL-KLK" ? "(chainage ex-KLK)" : seg.corridor === "RRTS" ? "(NCRTC km)" : "(NR chainage ex-DLI)";
  return {
    chainage: `Km ${(baseKm + seg.lengthKm / 10).toFixed(1)} – ${(baseKm + seg.lengthKm + seg.lengthKm / 10).toFixed(1)} ${lineRef}`,
    jurisdiction: `SSE/P.Way/${seg.to === "NDLS" ? "DLI" : seg.to} · Sr.DEN/${(h % 3) + 1}/DLI (NR)`,
    ohe: seg.corridor === "RRTS" ? "NCRTC 25 kV · RSS Ghaziabad" : `OHE Depot ${seg.to} · TSS ${seg.from}-${seg.to}`,
    rail: `${h % 2 === 0 ? "60E1" : "52 kg"} ${h % 3 === 0 ? "HH" : "90 UTS"} rail · laid ${2011 + (h % 13)}`,
    sleeper: `PSC mono-block · ${1520 + (h % 3) * 60}/km · ${h % 2 === 0 ? "LWR" : "SWR"}`,
    signalling: `${3 + (h % 8)} signals · ${h % 2 === 0 ? "AFTC" : "DC track circuit"} · ${seg.criticality >= 8 ? "4-aspect MACLS" : "MACLS"}`,
    lcGates: seg.isLevelCrossing ? `${2 + (h % 5)} LC gates interlocked (DTP-synced)` : "No LC gates",
    tsr: h % 4 === 0 ? `TSR 30 km/h curve km ${baseKm + 2}.${h % 9}` : "No permanent TSR",
    geom: `${seg.lengthKm} km · max ${seg.maxSpeed} km/h · ${seg.dailyTrains} trains/day · criticality ${seg.criticality}/10`,
  };
}
