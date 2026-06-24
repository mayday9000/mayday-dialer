CREATE TABLE "campaign_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid,
	"e164" text NOT NULL,
	"twilio_sid" text,
	"area_code" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_numbers" ADD CONSTRAINT "campaign_numbers_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_numbers_campaign_idx" ON "campaign_numbers" USING btree ("campaign_id");