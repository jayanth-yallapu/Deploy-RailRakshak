CREATE TABLE "benchmarks" (
	"id" serial PRIMARY KEY NOT NULL,
	"ran_at" timestamp DEFAULT now() NOT NULL,
	"horizon" text DEFAULT 'WEEKLY' NOT NULL,
	"runs" integer NOT NULL,
	"seed" integer DEFAULT 1 NOT NULL,
	"report" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "block_items" ADD COLUMN "policy" jsonb;--> statement-breakpoint
ALTER TABLE "block_items" ADD COLUMN "explain" jsonb;--> statement-breakpoint
ALTER TABLE "block_items" ADD COLUMN "override_reason" text;