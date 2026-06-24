ALTER TABLE "campaigns" ADD COLUMN "meeting_title_template" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "meeting_description_template" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "meeting_duration_min" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "meeting_location" text;