"use client";

import { useState } from "react";
import { AlertTriangle, BadgeCheck, BookOpenCheck, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import type { BlockItemDTO, PlanDTO } from "@/lib/engine/types";

interface Props {
  plan: PlanDTO | null;
  /** Violation introduced by the last drag, quoted from the server's verdict. */
  dragBreach?: string | null;
  /** Non-null when approval was refused by the gate. */
  gate?: { breaches: { blockItemId: number; segmentCode: string; when: string; violations: string[] }[]; policyScore: number } | null;
  overrideReason: string;
  setOverrideReason: (v: string) => void;
  onOverride: (reason: string) => void;
  busy?: boolean;
  blocks: BlockItemDTO[];
}

const scoreColor = (n: number) => (n >= 97 ? "text-emerald-400" : n >= 85 ? "text-amber-400" : "text-rose-400");

/**
 * The compliance ledger for the published plan.
 *
 * It reads the same `plan.policy` the server computed — the numbers here are never re-derived in the
 * browser, so what the DRM sees and what the gate enforced are the same evaluation.
 */
export default function PolicyLedger({ plan, dragBreach, gate, overrideReason, setOverrideReason, onOverride, busy, blocks }: Props) {
  const [open, setOpen] = useState(false);
  const pol = plan?.policy;
  const flagged = blocks.filter((b) => (b.policy?.violations.length ?? 0) > 0);
  const warned = blocks.filter((b) => !b.policy?.violations.length && (b.policy?.warnings.length ?? 0) > 0);

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-edge px-5 py-3">
        <span className="flex items-center gap-2">
          {pol && pol.hardViolations === 0 ? (
            <ShieldCheck size={16} className="text-emerald-400" />
          ) : (
            <ShieldAlert size={16} className="text-rose-400" />
          )}
          <span className="text-xs font-bold uppercase tracking-wider text-dim">Block rule book</span>
        </span>
        {pol ? (
          <>
            <span className={`font-mono text-lg font-bold leading-none ${scoreColor(pol.score)}`}>{pol.score}</span>
            <span className="text-[11px] text-faint">policy score</span>
            <span className="text-xs text-dim">
              {pol.compliantBlocks}/{blocks.length} blocks clean
              {pol.hardViolations > 0 && <span className="ml-2 text-rose-400">{pol.hardViolations} hard breach</span>}
              {pol.softWarnings > 0 && <span className="ml-2 text-amber-400">{pol.softWarnings} advisory</span>}
            </span>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="ml-auto flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-dim transition hover:text-ink"
            >
              <BookOpenCheck size={13} />
              {open ? "Hide" : "Show"} rules ({pol.rules.length})
            </button>
          </>
        ) : (
          <span className="text-xs text-faint">No plan loaded — run the optimizer to evaluate compliance.</span>
        )}
      </div>

      {open && pol && (
        <ul className="grid grid-cols-1 gap-px border-b border-edge bg-edge md:grid-cols-2">
          {pol.rules.map((r) => (
            <li key={r.id} className="bg-hull px-5 py-2.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-faint">{r.id}</span>
                <span className="text-xs font-semibold text-ink">{r.label}</span>
                <span
                  className={`ml-auto rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                    r.severity === "hard" ? "bg-rose-500/15 text-rose-400" : "bg-amber-500/15 text-amber-400"
                  }`}
                >
                  {r.severity === "hard" ? "blocks publication" : "advisory"}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-dim">{r.clause}</p>
            </li>
          ))}
        </ul>
      )}

      {pol && flagged.length > 0 && (
        <div className="border-b border-edge bg-rose-500/[0.06] px-5 py-3">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-rose-400">
            <AlertTriangle size={13} /> {flagged.length} block(s) breach a hard rule
          </p>
          <ul className="space-y-1">
            {flagged.map((b) => (
              <li key={b.id} className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                <span className="font-mono text-ink">
                  {b.segmentCode} · D+{b.day}
                </span>
                <span className="text-dim">
                  {b.departments.join("+")} · {Math.round((b.endMin - b.startMin) / 60 * 10) / 10} h
                </span>
                <span className="text-rose-300">{b.policy?.violations.join(" · ")}</span>
                {b.overrideReason && <span className="text-amber-300">overridden: {b.overrideReason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {pol && warned.length > 0 && !flagged.length && (
        <p className="border-b border-edge px-5 py-2 text-[11px] text-amber-400/90">
          {warned.length} advisory note(s) — execution is allowed, but read them before signing (
          {warned
            .slice(0, 2)
            .map((b) => `${b.segmentCode}: ${b.policy?.warnings[0]}`)
            .join(" · ")}
          {warned.length > 2 ? ` · +${warned.length - 2} more` : ""})
        </p>
      )}

      {dragBreach && !gate && (
        <p className="border-b border-edge bg-rose-500/[0.05] px-5 py-2 text-[11px] text-rose-300">
          That drag broke a rule: {dragBreach}. Move the block back, or the plan cannot be approved.
        </p>
      )}

      {gate && (
        <div className="space-y-2 border-t border-edge bg-rose-500/[0.07] px-5 py-3">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-rose-400">
            <ShieldAlert size={14} /> Approval refused — policy score {gate.policyScore}
          </p>
          <ul className="space-y-1">
            {gate.breaches.map((b) => (
              <li key={b.blockItemId} className="text-[11px] text-dim">
                <span className="font-mono text-ink">
                  {b.segmentCode} {b.when}
                </span>{" "}
                — <span className="text-rose-300">{b.violations.join(" · ")}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-faint">
            Move the flagged blocks back onto compliant slots and run again. If the plan must go out as
            it stands, the only way through is a recorded reason — it is written onto those blocks and
            into the audit trail.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Override reason (mandatory) — e.g. 'Divisional exemption 47, night cancelled for VVIP'"
              className="min-w-64 flex-1 rounded-lg border border-edge bg-hull px-3 py-1.5 text-xs text-ink placeholder:text-faint focus:border-amber-500/60 focus:outline-none"
            />
            <button
              type="button"
              disabled={!overrideReason.trim() || busy}
              onClick={() => onOverride(overrideReason.trim())}
              className="flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/25 disabled:opacity-40"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <BadgeCheck size={13} />} Approve with override
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
