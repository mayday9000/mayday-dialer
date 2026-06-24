CREATE TABLE "harvest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"search_id" uuid,
	"trigger" text NOT NULL,
	"found" integer DEFAULT 0 NOT NULL,
	"new_count" integer DEFAULT 0 NOT NULL,
	"dupes" integer DEFAULT 0 NOT NULL,
	"rejected" integer DEFAULT 0 NOT NULL,
	"queued" integer DEFAULT 0 NOT NULL,
	"approved" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "harvest_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"vertical" text DEFAULT 'property_management' NOT NULL,
	"keywords" text,
	"location" text NOT NULL,
	"state" text,
	"radius_meters" integer DEFAULT 40000 NOT NULL,
	"extra_locations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"providers" jsonb DEFAULT '["yelp"]'::jsonb NOT NULL,
	"target_campaign_id" uuid,
	"require_website" boolean DEFAULT false NOT NULL,
	"require_phone" boolean DEFAULT true NOT NULL,
	"min_rating" real,
	"min_reviews" integer,
	"max_per_run" integer DEFAULT 30 NOT NULL,
	"custom_rules" text,
	"min_dialable" integer DEFAULT 25 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"cadence" text DEFAULT 'on_low' NOT NULL,
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "enrichment" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "review_state" text;--> statement-breakpoint
ALTER TABLE "harvest_runs" ADD CONSTRAINT "harvest_runs_search_id_harvest_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."harvest_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harvest_searches" ADD CONSTRAINT "harvest_searches_target_campaign_id_campaigns_id_fk" FOREIGN KEY ("target_campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "harvest_runs_search_idx" ON "harvest_runs" USING btree ("search_id");--> statement-breakpoint
CREATE INDEX "harvest_searches_active_idx" ON "harvest_searches" USING btree ("active");