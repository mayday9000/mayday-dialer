ALTER TABLE "call_logs" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_logs_campaign_idx" ON "call_logs" USING btree ("campaign_id");--> statement-breakpoint
-- Backfill: attribute each existing call to the lead's ORIGINAL (oldest) campaign
-- membership. Calls predate any lead-sharing, so the oldest membership is the
-- campaign the call was actually made under — this keeps historical calls out of
-- any campaign a lead was only recently copied into.
UPDATE "call_logs" cl
SET "campaign_id" = sub.campaign_id
FROM (
  SELECT DISTINCT ON (lead_id) lead_id, campaign_id
  FROM "campaign_leads"
  ORDER BY lead_id, added_at ASC
) sub
WHERE cl."lead_id" = sub.lead_id AND cl."campaign_id" IS NULL;