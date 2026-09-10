/**
 * Single source of truth for severity representation.
 *
 * Why this exists: `defects.severity` is stored as text ("critical" | "high" | "medium" | "low")
 * because that is what a patroller picks on the phone, but the risk model, the optimizer and the
 * UI all need a 1–10 number. Before this module existed, three separate files each carried their
 * own copy of the mapping (optimizer.ts `sevNum`, state.ts `severityToNum`, and one ad-hoc
 * multiply in simulate.ts) — which is exactly how a probability ended up being 0–100 in the API
 * and 0–1 in the table cell. Keep every conversion here.
 */

export const SEVERITY_LEVELS = ["low", "medium", "high", "critical"] as const;
export type SeverityLabel = (typeof SEVERITY_LEVELS)[number];

const LABEL_TO_NUM: Record<string, number> = {
  low: 2,
  medium: 5,
  high: 8,
  critical: 10,
};

/** "critical" → 10, "high" → 8, "medium" → 5, anything else → 2. Numbers pass through (clamped). */
export function severityToNum(s: string | number | null | undefined): number {
  if (typeof s === "number") return Math.max(1, Math.min(10, Math.round(s)));
  if (!s) return 2;
  return LABEL_TO_NUM[String(s).toLowerCase().trim()] ?? 2;
}

/** 8 → "high". Rounds to the nearest of the four stored labels. */
export function numToSeverity(n: number): SeverityLabel {
  if (n >= 9) return "critical";
  if (n >= 7) return "high";
  if (n >= 4) return "medium";
  return "low";
}

/** Label used for CSS/labels — defensive against unexpected DB values. */
export function isCritical(sev: string | number | null | undefined): boolean {
  return severityToNum(sev) >= 8;
}
