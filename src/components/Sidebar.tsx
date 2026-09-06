"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CalendarCog, FlaskConical, HardHat, KeyRound, LayoutGrid, Radar, ShieldHalf, TrainFront, Wrench } from "lucide-react";
import { getRole, setRole, ROLE_META, DEPT_LABEL, type Role, type RoleInfo } from "@/lib/role";

const NAV = [
  { href: "/command", label: "Command Center", icon: Radar, hint: "Live grid · fog · VIP", roles: ["DRM", "CONTROL"] },
  { href: "/planner", label: "AI Planner", icon: CalendarCog, hint: "constraint solver", roles: ["DRM", "CONTROL"] },
  { href: "/simulation", label: "Simulation Lab", icon: FlaskConical, hint: "What-if · crisis", roles: ["DRM", "CONTROL"] },
  { href: "/field", label: "Field Operations", icon: HardHat, hint: "Allot · verify · sign-off", roles: ["INSPECTOR", "DRM"] },
  { href: "/jobs", label: "My Job Portal", icon: Wrench, hint: "Job cards · photo proof", roles: ["KARMI"] },
];

const UPLINKS = ["TMS", "TDMS", "SMMS", "COA", "RDPMS", "FOIS"];

export default function Sidebar() {
  const path = usePathname();
  const router = useRouter();
  const [role, setRoleState] = useState<RoleInfo | null>(null);
  const [switching, setSwitching] = useState(false);

  function quickSwitch(r: Role) {
    // instant (< 500 ms) — global state swap + client-nav, no page reload
    setRole({ role: r, dept: r === "KARMI" ? (role?.dept ?? "ENG") : undefined });
    setSwitching(false);
    router.push(ROLE_META[r].dest);
  }

  useEffect(() => {
    setRoleState(getRole());
    const sync = () => setRoleState(getRole());
    window.addEventListener("rr-role", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("rr-role", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const visibleNav = role ? NAV.filter((n) => n.roles.includes(role.role)) : [];
  const meta = role ? ROLE_META[role.role] : null;

  return (
    <aside className="sticky top-0 hidden h-screen w-[234px] shrink-0 flex-col border-r border-edge/70 bg-hull/80 backdrop-blur-md lg:flex">
      <Link href="/" className="flex items-center gap-3 border-b border-edge/70 px-5 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-saffron to-amber text-abyss">
          <TrainFront size={19} strokeWidth={2.4} />
        </span>
        <span>
          <span className="block text-[14px] font-bold tracking-[0.08em] text-ink">RAIL RAKSHAK</span>
          <span className="block font-mono text-[8.5px] uppercase tracking-[0.2em] text-faint">NR · Delhi Division</span>
        </span>
      </Link>

      {/* role badge */}
      <div className="border-b border-edge/70 px-3 py-3">
        {role && meta ? (
          <div className="rounded-lg border p-2.5" style={{ borderColor: `${meta.color}44`, background: `${meta.color}12` }}>
            <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-faint">Signed in as</p>
            <p className="mt-0.5 text-[12px] font-bold" style={{ color: meta.color }}>
              {role.role === "KARMI" && role.dept ? DEPT_LABEL[role.dept].split(" — ")[0] : meta.label}
            </p>
            {role.role === "KARMI" && role.dept && (
              <p className="font-mono text-[8.5px] text-dim">{DEPT_LABEL[role.dept].split(" — ")[1]}</p>
            )}
          </div>
        ) : (
          <Link href="/login" className="flex items-center gap-2 rounded-lg border border-amber/40 bg-amber/10 p-2.5 text-amber transition hover:bg-amber/20">
            <KeyRound size={14} />
            <span className="text-[12px] font-bold">Sign in to command</span>
          </Link>
        )}
      </div>

      <nav className="flex flex-col gap-1.5 px-3 py-4">
        <p className="px-2 pb-1 font-mono text-[9px] uppercase tracking-[0.22em] text-faint">Operate</p>
        {visibleNav.map((n) => {
          const active = path.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`group flex items-center gap-3 rounded-lg border px-3 py-2.5 transition ${
                active
                  ? "border-amber/30 bg-amber/10 text-amber"
                  : "border-transparent text-dim hover:border-edge hover:bg-white/[0.03] hover:text-ink"
              }`}
            >
              <n.icon size={16} />
              <span>
                <span className="block text-[12.5px] font-semibold leading-tight">{n.label}</span>
                <span className="block font-mono text-[8.5px] uppercase tracking-wider text-faint">{n.hint}</span>
              </span>
            </Link>
          );
        })}
        <p className="px-2 pb-1 pt-4 font-mono text-[9px] uppercase tracking-[0.22em] text-faint">Briefing</p>
        <Link
          href="/"
          className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition ${
            path === "/" ? "border-amber/30 bg-amber/10 text-amber" : "border-transparent text-dim hover:border-edge hover:bg-white/[0.03] hover:text-ink"
          }`}
        >
          <LayoutGrid size={16} />
          <span>
            <span className="block text-[12.5px] font-semibold leading-tight">Mission Overview</span>
            <span className="block font-mono text-[8.5px] uppercase tracking-wider text-faint">SIH 2026 · #26027</span>
          </span>
        </Link>
      </nav>

      <div className="mt-auto space-y-3 border-t border-edge/70 px-5 py-4">
        <div className="flex items-center gap-2">
          <ShieldHalf size={13} className="text-mint" />
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-mint">Departmental agents · live</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {UPLINKS.map((u) => (
            <span key={u} className="flex items-center gap-1 rounded-md border border-edge/70 bg-white/[0.02] px-1.5 py-1 font-mono text-[8.5px] text-dim">
              <span className="anim-blink h-1 w-1 rounded-full bg-mint" />
              {u}
            </span>
          ))}
        </div>
        {role && (
          <div>
            <button
              onClick={() => setSwitching(!switching)}
              className="flex w-full items-center gap-2 rounded-lg border border-edge px-2.5 py-2 font-mono text-[9px] uppercase tracking-widest text-dim transition hover:border-white/20 hover:text-ink"
            >
              <KeyRound size={11} /> Switch role instantly
            </button>
            {switching && (
              <div className="anim-rise mt-1.5 grid grid-cols-2 gap-1">
                {(["DRM", "CONTROL", "INSPECTOR", "KARMI"] as Role[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => quickSwitch(r)}
                    className="rounded-md border border-white/[0.08] px-1.5 py-1.5 font-mono text-[8px] font-bold transition hover:border-white/25"
                    style={{ color: ROLE_META[r].color, background: `${ROLE_META[r].color}10` }}
                  >
                    {r === "CONTROL" ? "COA" : r}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
