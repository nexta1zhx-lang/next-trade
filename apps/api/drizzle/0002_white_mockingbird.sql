CREATE TABLE "asset_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"api_key_id" integer NOT NULL,
	"snap_date" varchar(10) NOT NULL,
	"total_equity" numeric(24, 8) NOT NULL,
	"spot_value" numeric(24, 8) DEFAULT '0',
	"contract_equity" numeric(24, 8) DEFAULT '0',
	"unrealized_pnl" numeric(24, 8) DEFAULT '0',
	"snapshot_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capital_flows" (
	"id" serial PRIMARY KEY NOT NULL,
	"api_key_id" integer NOT NULL,
	"flow_type" varchar(20) NOT NULL,
	"amount" numeric(24, 8) NOT NULL,
	"flow_date" varchar(10) NOT NULL,
	"note" text DEFAULT '',
	"occurred_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_snapshots" ADD CONSTRAINT "asset_snapshots_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capital_flows" ADD CONSTRAINT "capital_flows_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ass_key_date" ON "asset_snapshots" USING btree ("api_key_id","snap_date");--> statement-breakpoint
CREATE INDEX "idx_cf_key_date" ON "capital_flows" USING btree ("api_key_id","flow_date");