import { sql } from "drizzle-orm";
import { db, pool } from "./index";

/**
 * Additive schema repair for the Tier-1 columns and tables.
 *
 * This template applies `drizzle/` migrations when the database is provisioned, so a fresh clone is
 * already correct. An instance that was provisioned *before* these additions (the demo machine, a
 * judge's laptop) would otherwise crash with `column block_items.policy does not exist` the first
 * time the Gantt renders a compliance chip — the exact "new feature broke an existing page" failure
 * mode this project has been bitten by. Everything here is `IF [NOT] EXISTS`, so it is a no-op on a
 * current database and a repair on a stale one. Never destructive: it adds, it never alters or drops.
 */
const TIER1_DDL = [
  `ALTER TABLE "block_items" ADD COLUMN IF NOT EXISTS "policy" jsonb`,
  `ALTER TABLE "block_items" ADD COLUMN IF NOT EXISTS "explain" jsonb`,
  `ALTER TABLE "block_items" ADD COLUMN IF NOT EXISTS "override_reason" text`,
  `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "supersedes_id" integer`,
  `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "trigger_note" text`,
  `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "diff" jsonb`,
  `CREATE TABLE IF NOT EXISTS "benchmarks" (
     "id" serial PRIMARY KEY NOT NULL,
     "ran_at" timestamp DEFAULT now() NOT NULL,
     "horizon" text DEFAULT 'WEEKLY' NOT NULL,
     "runs" integer NOT NULL,
     "seed" integer DEFAULT 1 NOT NULL,
     "report" jsonb NOT NULL
   )`,
];

let running: Promise<void> | null = null;

/** Idempotent, once per process. If the database is not even reachable we log and continue: the
 *  pages that only read existing tables must keep working rather than 500 on a migration attempt. */
export function ensureTier1Schema(): Promise<void> {
  if (!running) {
    running = (async () => {
      try {
        // A missing `block_items` table means the base migrations have not run at all; adding
        // columns to it would throw, and the base schema is not this function's business.
        const has = await pool.query(
          `select 1 from information_schema.tables where table_schema='public' and table_name='block_items'`
        );
        if (has.rowCount === 0) return;
        for (const stmt of TIER1_DDL) await db.execute(sql.raw(stmt));
      } catch (e) {
        console.warn("[schema] tier-1 additive migration skipped:", String(e).slice(0, 200));
        running = null; // let a later request retry after a transient failure
      }
    })();
  }
  return running;
}
