ALTER TABLE "campaigns" ADD COLUMN "brief" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "industry" text;--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "campaign_id" uuid;