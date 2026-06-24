CREATE TABLE "call_transcripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_log_id" uuid,
	"lead_id" uuid NOT NULL,
	"user_id" text,
	"call_sid" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"recording_sid" text,
	"recording_duration_sec" integer,
	"provider_transcript_sid" text,
	"language" text DEFAULT 'en',
	"segments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"analysis" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_logs" ADD COLUMN "recording_sid" text;--> statement-breakpoint
ALTER TABLE "call_logs" ADD COLUMN "recording_duration_sec" integer;--> statement-breakpoint
ALTER TABLE "call_transcripts" ADD CONSTRAINT "call_transcripts_call_log_id_call_logs_id_fk" FOREIGN KEY ("call_log_id") REFERENCES "public"."call_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_transcripts" ADD CONSTRAINT "call_transcripts_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_transcripts_lead_idx" ON "call_transcripts" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "call_transcripts_call_log_idx" ON "call_transcripts" USING btree ("call_log_id");--> statement-breakpoint
CREATE INDEX "call_transcripts_call_sid_idx" ON "call_transcripts" USING btree ("call_sid");--> statement-breakpoint
CREATE INDEX "call_logs_call_sid_idx" ON "call_logs" USING btree ("provider_call_sid");