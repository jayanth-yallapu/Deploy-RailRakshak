"use client";

import { useCallback, useEffect, useState } from "react";
import { GitCommitHorizontal, Loader2, Radio, RefreshCw, ShieldAlert } from "lucide-react";

/**
 * The re-plan console: what happens to a notified schedule when the ground truth changes at 02:10.
 *
 * Two views, because the jury question is "does it re-optimise?" and the operating question is "will
 * it survive contact with a division":
 *   - **Preview** runs both planners as dry runs against the plan in force and puts them side by side:
 *     the minimal edit and the full re-optimisation, with the difference stated in blocks, minutes and
 *     train-delay. Nothing is written, so it can be clicked repeatedly.
 *   - **Publish** writes the chosen re-plan as a new version that supersedes the old one, and lists the
 *     working advice each department would receive.
 */

type Kind = "unchanged" | "moved" | "added" | "dropped" | "held";

interface DiffBlock {
  segmentId: number;
  code: string;
  kind: Kind;
  from?: { day: number; startMin: number; endMin: number };
  to?: { day: number; startMin: number; endMin: number };
  shiftMin: number;
  nights: number;
  lengthDeltaMin: number;
  note: string;
  locked: boolean;
  departments: string[];
  defectIds: number[];
}

interface Diff {
  previousPlanId: number | null;
  newPlanId: number | null;
  stabilityPct: number;
  unchanged: number;
  moved: number;
  added: number;
  dropped: number;
  held: number;
  shiftMinutes: number;
  nightsChanged: number;
  blocks: DiffBlock[];
  trigger: string;
  mode: "incremental" | "full";
  affectedSections: string[];
  escalation: string | null;
}

interface Metrics {
  planId: number | null;
  blocks: number;
  defectsCleared: number;
  deferredItems: number;
  delayTrainMin: number;
  occupancyUsedMin: number;
  coveragePct: number;
  policyScore: number;
  hardViolations: number;
}

interface ReplanResponse {
  replanned: boolean;
  dryRun: boolean;
  diff: Diff;
  metrics: Metrics;
  log: string[];
  notified: { department: string; blocks: string[] }[];
  error?: string;
}

interface ChainRow {
  id: number;
  name: string;
  horizon: string;
  supersedesId: number | null;
  triggerNote: string | null;
  blocks: number;
  delayTrainMin: number;
  stabilityPct: number | null;
  added: number | null;
  moved: number | null;
  dropped: number | null;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hhmm = (min: number) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const when = (b?: { day: number; startMin: number; endMin: number }) =>
  b ? `${DAY_NAMES[b.day % 7] ?? `D+${b.day}`} ${hhmm(b.startMin)}–${hhmm(b.endMin)}` : "—";

const KIND_STYLE: Record<Kind, string> = {
  added: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  moved: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  dropped: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  held: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  unchanged: "border-edge bg-[#0A0E17]/50 text-dim",
};

async function postReplan(body: Record<string, unknown>): Promise<ReplanResponse> {
  const res = await fetch("/api/replan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as ReplanResponse & { error?: string };
  if (!res.ok || data.error) throw new Error(data.error ?? `replan failed (${res.status})`);
  return data;
}

export default function ReplanPanel({ onPublished }: { onPublished?: () => void }) {
  const [preview, setPreview] = useState<{ inc: ReplanResponse; full: ReplanResponse } | null>(null);
  const [published, setPublished] = useState<ReplanResponse | null>(null);
  const [chain, setChain] = useState<ChainRow[]>([]);
  const [lastDiff, setLastDiff] = useState<Diff | null>(null);
  const [note, setNote] = useState("02:10 on-foot report: transverse rail head crack");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState<"preview" | "publish" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = (await fetch("/api/replan", { cache: "no-store" }).then((r) => r.json())) as {
        chain?: ChainRow[];
        diff?: Diff | null;
      };
      setChain(d.chain ?? []);
      setLastDiff(d.diff ?? null);
    } catch {
      /* the panel still works — it just has no history to show yet */
    }
  }, []);

  // The chain is read once on mount; `load()` is for refreshing it after a publish. Written as a
  // promise chain with a cancellation guard so a late response cannot land on an unmounted panel.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/replan", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { chain?: ChainRow[]; diff?: Diff | null }) => {
        if (cancelled) return;
        setChain(d.chain ?? []);
        setLastDiff(d.diff ?? null);
      })
      .catch(() => {
        /* no history yet — the panel still works */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function runPreview() {
    setBusy("preview");
    setErr(null);
    try {
      // Both from the same starting plan, both dry: only then is the comparison between the minimal
      // edit and a fresh re-optimisation an answer rather than an artefact of run order.
      const [inc, full] = await Promise.all([
        postReplan({ mode: "incremental", dryRun: true, churnWeight: 150, triggerNote: note }),
        postReplan({ mode: "full", dryRun: true, triggerNote: note }),
      ]);
      setPreview({ inc, full });
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    setBusy("publish");
    setErr(null);
    try {
      const res = await postReplan({ mode: "incremental", notify, triggerNote: note });
      setPublished(res);
      setPreview(null);
      onPublished?.();
      await load();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }

  const shown = published?.diff ?? preview?.inc.diff ?? lastDiff;
  const inc = preview?.inc;
  const full = preview?.full;
  const nothingToD = published ? !published.replanned : inc ? !inc.replanned && !inc.dryRun : false;
  const rows = shown ? (showAll ? shown.blocks : shown.blocks.filter((b) => b.kind !== "unchanged").slice(0, 12)) : [];
  const hiddenUnchanged = shown ? shown.blocks.filter((b) => b.kind === "unchanged").length : 0;

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-edge px-5 py-3">
        <span className="flex items-center gap-2">
          <RefreshCw size={16} className="text-amber-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-dim">Incremental re-plan</span>
        </span>
        <span className="text-[11px] text-faint">
          a new defect at 02:10 → the schedule is edited minimally, not re-cut
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={runPreview}
            disabled={busy !== null}
            className="flex items-center gap-1.5 rounded-md border border-edge bg-[#0A0E17]/60 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-dim transition hover:text-ink disabled:opacity-40"
          >
            {busy === "preview" ? <Loader2 size={12} className="animate-spin" /> : <GitCommitHorizontal size={12} />}
            Preview both
          </button>
          <button
            type="button"
            onClick={publish}
            disabled={busy !== null}
            className="flex items-center gap-1.5 rounded-md border border-amber-500/50 bg-amber-500/15 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-300 transition hover:bg-amber-500/25 disabled:opacity-40"
          >
            {busy === "publish" ? <Loader2 size={12} className="animate-spin" /> : <Radio size={12} />}
            Publish re-plan
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 px-5 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">What triggered it (stored on the new plan)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={240}
            className="mt-1 w-full rounded-md border border-edge bg-[#0A0E17]/60 px-2 py-1.5 font-mono text-[11.5px] text-ink outline-none focus:border-amber-500/50"
          />
        </label>
        <label className="flex items-end gap-2 pb-1 text-[11px] text-dim">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="accent-amber-500" />
          Send working advice only to the departments whose blocks changed
        </label>
        <div className="flex items-end pb-1 font-mono text-[10.5px] text-faint">
          chain: {chain.length ? chain.map((c) => `#${c.id}`).slice(-4).join(" → ") : "no plans yet"}
        </div>
      </div>

      {err && (
        <p className="border-t border-edge bg-rose-500/10 px-5 py-2 font-mono text-[11px] text-rose-300">re-plan refused: {err}</p>
      )}

      {nothingToD && published && (
        <p className="border-t border-edge bg-emerald-500/10 px-5 py-2 text-[11.5px] text-emerald-300">
          {published.log[0] ?? "Nothing changed."} — no new plan version was created, so the notified
          diagram stands exactly as it is.
        </p>
      )}

      {inc && full && (
        <div className="grid grid-cols-1 gap-px border-t border-edge bg-edge md:grid-cols-3">
          {[
            { t: "Incremental (minimal edit)", r: inc, tone: "text-emerald-300" },
            { t: "Full re-optimisation", r: full, tone: "text-amber-300" },
          ].map(({ t, r, tone }) => (
            <div key={t} className="bg-[#080d16] p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-faint">{t}</p>
              <p className={`mt-1 font-mono text-2xl font-bold leading-none ${tone}`}>{r.diff.stabilityPct}%</p>
              <p className="text-[10.5px] text-dim">blocks unchanged vs the plan in force</p>
              <dl className="mt-2 space-y-0.5 font-mono text-[10.5px] text-dim">
                {[
                  ["kept / moved / new / released", `${r.diff.unchanged} / ${r.diff.moved} / ${r.diff.added} / ${r.diff.dropped}`],
                  ["carried without re-solving", `${r.diff.held}`],
                  ["start-time churn", `${r.diff.shiftMinutes} min`],
                  ["nights that changed", `${r.diff.nightsChanged}`],
                  ["train-min delay (reported)", `${r.metrics.delayTrainMin}`],
                  ["blocks / items cleared", `${r.metrics.blocks} / ${r.metrics.defectsCleared}`],
                  ["could not be placed", `${r.metrics.deferredItems}`],
                  ["rule-book score", `${r.metrics.policyScore}${r.metrics.hardViolations ? ` · ${r.metrics.hardViolations} hard` : ""}`],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-faint">{k}</dt>
                    <dd className="text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
          <div className="bg-[#080d16] p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-faint">What stability costs here</p>
            <p className="mt-1 font-mono text-2xl font-bold leading-none text-ink">
              {full.diff.stabilityPct - inc.diff.stabilityPct >= 0 ? "−" : "+"}
              {Math.abs(full.diff.stabilityPct - inc.diff.stabilityPct)} pts
            </p>
            <p className="text-[10.5px] text-dim">
              stability given up if the division re-cuts the whole week instead of editing it
            </p>
            <dl className="mt-2 space-y-0.5 font-mono text-[10.5px] text-dim">
              {[
                ["extra delay the full re-cut carries", `${full.metrics.delayTrainMin - inc.metrics.delayTrainMin} min`],
                ["extra nights disturbed", `${full.diff.nightsChanged - inc.diff.nightsChanged}`],
                ["blocks the full re-cut adds or drops", `${full.metrics.blocks - inc.metrics.blocks}`],
                ["items left unplaced by the minimal edit", `${inc.metrics.deferredItems}`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-faint">{k}</dt>
                  <dd className="text-ink">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-[10px] leading-snug text-faint">
              Both computed as dry runs from plan #{inc.diff.previousPlanId}; nothing was written. A
              positive delay figure means the minimal edit is leaving something on the table, and the
              division should re-cut — that is the decision this panel is for.
            </p>
          </div>
        </div>
      )}

      {shown && (
        <div className="border-t border-edge">
          <div className="flex flex-wrap items-center gap-2 px-5 py-2 text-[11px]">
            <span className="font-mono text-dim">
              plan #{shown.previousPlanId}
              {shown.newPlanId && shown.newPlanId !== shown.previousPlanId ? ` → #${shown.newPlanId}` : " (unchanged)"}
            </span>
            <span className="text-faint">·</span>
            <span className="text-dim">
              affected: <span className="font-mono text-ink">{shown.affectedSections.join(", ") || "none"}</span>
            </span>
            <span className="text-faint">·</span>
            <span className="text-dim">
              trigger: <span className="font-mono italic text-ink">{shown.trigger}</span>
            </span>
            {shown.mode === "full" && <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 text-[10px] font-bold uppercase text-amber-300">full re-cut</span>}
            {published && <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 text-[10px] font-bold uppercase text-emerald-300">published</span>}
          </div>

          {shown.escalation && (
            <p className="mx-5 mb-2 flex items-start gap-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11.5px] text-rose-200">
              <ShieldAlert size={13} className="mt-0.5 shrink-0" />
              <span>{shown.escalation}</span>
            </p>
          )}

          <div className="divide-y divide-edge/60">
            {rows.map((b) => (
              <div key={`${b.code}-${b.kind}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2">
                <span className={`w-[68px] shrink-0 rounded border px-1.5 py-0.5 text-center text-[9.5px] font-bold uppercase tracking-wide ${KIND_STYLE[b.kind]}`}>
                  {b.kind}
                </span>
                <span className="w-[104px] shrink-0 font-mono text-[11.5px] font-semibold text-ink">{b.code}</span>
                <span className="font-mono text-[11px] text-dim">
                  {b.kind === "moved" ? (
                    <>
                      <span className="text-faint">{when(b.from)}</span> → <span className="text-ink">{when(b.to)}</span>
                    </>
                  ) : b.kind === "added" ? (
                    <span className="text-ink">{when(b.to)}</span>
                  ) : b.kind === "dropped" ? (
                    <span className="text-faint line-through">{when(b.from)}</span>
                  ) : (
                    <span className="text-dim">{when(b.to ?? b.from)}</span>
                  )}
                </span>
                <span className="min-w-[220px] flex-1 text-[11px] text-faint">{b.note}</span>
                {b.locked && (
                  <span className="rounded border border-rose-500/40 bg-rose-500/10 px-1.5 text-[9.5px] font-bold uppercase text-rose-300">
                    locked · crews on line
                  </span>
                )}
                <span className="font-mono text-[10px] text-faint">{b.departments.join("/")}</span>
              </div>
            ))}
            {rows.length === 0 && (
              <p className="px-5 py-3 text-[11.5px] text-faint">
                Every block keeps its notified slot — the report was absorbed inside an existing
                occupation, so no department needs a new working advice.
              </p>
            )}
          </div>

          {hiddenUnchanged > 0 && !showAll && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="w-full border-t border-edge px-5 py-1.5 text-left text-[10.5px] uppercase tracking-wider text-dim transition hover:text-ink"
            >
              show all {shown.blocks.length} blocks ({hiddenUnchanged} unchanged not listed)
            </button>
          )}
          {showAll && (
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className="w-full border-t border-edge px-5 py-1.5 text-left text-[10.5px] uppercase tracking-wider text-dim transition hover:text-ink"
            >
              hide unchanged
            </button>
          )}
        </div>
      )}

      {(published?.log.length ?? 0) > 0 && (
        <div className="border-t border-edge bg-[#080d16] px-5 py-2 font-mono text-[10.5px] leading-relaxed text-dim">
          {published!.log.map((l, i) => (
            <p key={i}>
              <span className="mr-1.5 text-faint">▸</span>
              {l}
            </p>
          ))}
          {published!.notified.length > 0 && (
            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
              {published!.notified.map((n) => (
                <div key={n.department} className="rounded-md border border-edge bg-[#0A0E17]/60 p-2">
                  <p className="text-[9.5px] font-bold uppercase tracking-wider text-amber-300">working advice → {n.department}</p>
                  <ul className="mt-1 space-y-0.5 text-[10.5px] text-dim">
                    {n.blocks.map((line, i) => (
                      <li key={i}>· {line}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {chain.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-edge px-5 py-2 font-mono text-[10px] text-faint">
          <span className="uppercase tracking-wider">plan chain</span>
          {chain.map((c) => (
            <span key={c.id} className="rounded border border-edge bg-[#0A0E17]/60 px-1.5 py-0.5 text-dim" title={c.triggerNote ?? ""}>
              #{c.id} {c.blocks}blk
              {c.stabilityPct != null && <span className="text-emerald-400"> ·{c.stabilityPct}%</span>}
              {c.added != null && c.added > 0 && <span className="text-amber-400"> +{c.added}</span>}
              {c.dropped != null && c.dropped > 0 && <span className="text-rose-400"> −{c.dropped}</span>}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
