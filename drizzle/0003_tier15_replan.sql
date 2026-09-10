ALTER TABLE "plans" ADD COLUMN "supersedes_id" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "trigger_note" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "diff" jsonb;