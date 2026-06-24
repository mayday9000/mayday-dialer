CREATE TABLE "user_campaign_scripts" (
	"user_id" text NOT NULL,
	"campaign_id" uuid NOT NULL,
	"script_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_campaign_scripts_user_id_campaign_id_pk" PRIMARY KEY("user_id","campaign_id")
);
--> statement-breakpoint
ALTER TABLE "user_campaign_scripts" ADD CONSTRAINT "user_campaign_scripts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_campaign_scripts" ADD CONSTRAINT "user_campaign_scripts_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE cascade ON UPDATE no action;