CREATE TABLE "voicemails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid,
	"campaign_id" uuid,
	"market_id" uuid,
	"from_phone" text,
	"from_normalized" text,
	"to_number" text,
	"recording_sid" text,
	"recording_url" text,
	"duration_sec" integer DEFAULT 0 NOT NULL,
	"transcript_status" text DEFAULT 'pending' NOT NULL,
	"transcript_text" text,
	"summary" text,
	"handled" boolean DEFAULT false NOT NULL,
	"handled_by" text,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voicemails" ADD CONSTRAINT "voicemails_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voicemails" ADD CONSTRAINT "voicemails_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voicemails" ADD CONSTRAINT "voicemails_market_id_campaign_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."campaign_markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voicemails_created_idx" ON "voicemails" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "voicemails_handled_idx" ON "voicemails" USING btree ("handled");--> statement-breakpoint
CREATE INDEX "voicemails_lead_idx" ON "voicemails" USING btree ("lead_id");