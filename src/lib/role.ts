"use client";

export type Role = "DRM" | "CONTROL" | "INSPECTOR" | "KARMI";
export type Dept = "ENG" | "TRD" | "SNT";

export interface RoleInfo {
  role: Role;
  dept?: Dept;
}

const KEY = "railrakshak.role";

export function getRole(): RoleInfo | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RoleInfo) : null;
  } catch {
    return null;
  }
}

export function setRole(info: RoleInfo) {
  window.localStorage.setItem(KEY, JSON.stringify(info));
  window.dispatchEvent(new Event("rr-role"));
}

export function clearRole() {
  window.localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("rr-role"));
}

export function useRoleSync(cb: () => void) {
  if (typeof window !== "undefined") {
    window.addEventListener("rr-role", cb);
    return () => window.removeEventListener("rr-role", cb);
  }
  return () => {};
}

export const ROLE_META: Record<Role, { label: string; badge: string; color: string; dest: string; icon: string }> = {
  DRM: { label: "DRM / Admin", badge: "DRM — Strategic Override Active", color: "#ff4d4f", dest: "/command", icon: "shield" },
  CONTROL: { label: "Control Room / COA", badge: "Control Room — Live Operations", color: "#34d399", dest: "/command", icon: "radio" },
  INSPECTOR: { label: "Section Inspector", badge: "Inspector — Zone: NDLS Beat (SSE/P.Way)", color: "#f5a524", dest: "/field", icon: "hardhat" },
  KARMI: { label: "Maintenance Karmi", badge: "Karmi — Field Crew", color: "#a78bfa", dest: "/jobs", icon: "wrench" },
};

export const DEPT_LABEL: Record<Dept, string> = {
  ENG: "ENG Karmi — Track Division (TMS)",
  TRD: "TRD Karmi — Traction/OHE (TDMS)",
  SNT: "SNT Karmi — Signal & Telecom (SMMS)",
};
