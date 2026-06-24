ALTER TABLE "leads" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "claimed_by" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "claimed_at" timestamp with time zone;