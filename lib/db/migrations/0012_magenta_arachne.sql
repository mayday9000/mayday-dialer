CREATE TABLE "campaign_markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"state" text,
	"area_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_logs" ADD COLUMN "market_id" uuid;--> statement-breakpoint
ALTER TABLE "campaign_leads" ADD COLUMN "market_id" uuid;--> statement-breakpoint
ALTER TABLE "campaign_numbers" ADD COLUMN "market_id" uuid;--> statement-breakpoint
ALTER TABLE "dial_sessions" ADD COLUMN "market_id" uuid;--> statement-breakpoint
ALTER TABLE "harvest_searches" ADD COLUMN "market_id" uuid;--> statement-breakpoint
ALTER TABLE "campaign_markets" ADD CONSTRAINT "campaign_markets_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_markets_campaign_idx" ON "campaign_markets" USING btree ("campaign_id");--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_market_id_campaign_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."campaign_markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_market_id_campaign_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."campaign_markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_numbers" ADD CONSTRAINT "campaign_numbers_market_id_campaign_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."campaign_markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dial_sessions" ADD CONSTRAINT "dial_sessions_market_id_campaign_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."campaign_markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harvest_searches" ADD CONSTRAINT "harvest_searches_market_id_campaign_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."campaign_markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_logs_market_idx" ON "call_logs" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "campaign_leads_market_idx" ON "campaign_leads" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "campaign_numbers_market_idx" ON "campaign_numbers" USING btree ("market_id");--> statement-breakpoint
-- Multi-city backfill ------------------------------------------------------
-- Give every existing campaign one default market and tag all of its existing
-- leads / numbers / searches / calls to it. Guarded by is_default + market_id
-- IS NULL so a re-run after a partial failure is safe (Neon HTTP auto-commits
-- each statement; there is no enclosing transaction).
INSERT INTO "campaign_markets" ("campaign_id", "name", "location", "is_default", "created_by")
SELECT c."id", COALESCE(c."location", 'All'), c."location", true, c."created_by"
FROM "campaigns" c
WHERE NOT EXISTS (
	SELECT 1 FROM "campaign_markets" m
	WHERE m."campaign_id" = c."id" AND m."is_default" = true
);--> statement-breakpoint
UPDATE "campaign_leads" cl SET "market_id" = m."id"
FROM "campaign_markets" m
WHERE m."campaign_id" = cl."campaign_id" AND m."is_default" = true AND cl."market_id" IS NULL;--> statement-breakpoint
UPDATE "campaign_numbers" cn SET "market_id" = m."id"
FROM "campaign_markets" m
WHERE m."campaign_id" = cn."campaign_id" AND m."is_default" = true AND cn."market_id" IS NULL;--> statement-breakpoint
UPDATE "harvest_searches" hs SET "market_id" = m."id"
FROM "campaign_markets" m
WHERE m."campaign_id" = hs."target_campaign_id" AND m."is_default" = true AND hs."market_id" IS NULL;--> statement-breakpoint
UPDATE "call_logs" cl SET "market_id" = m."id"
FROM "campaign_markets" m
WHERE m."campaign_id" = cl."campaign_id" AND m."is_default" = true AND cl."market_id" IS NULL;