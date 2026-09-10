ALTER TABLE "defects" ALTER COLUMN "status" SET DEFAULT 'open';--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "cycle_days" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "last_inspected_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN "asset_id" integer;--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN "source_system" text DEFAULT 'TMS' NOT NULL;--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN "overdue_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN "duration_min" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN "inspection_mode" text DEFAULT 'physical' NOT NULL;--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN "requires_block" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN "reported_by" text;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;