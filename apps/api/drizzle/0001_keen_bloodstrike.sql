CREATE TABLE "account_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"api_key_id" integer NOT NULL,
	"total_net_value" numeric(24, 8) NOT NULL,
	"spot_balance" numeric(24, 8) DEFAULT '0',
	"contract_equity" numeric(24, 8) DEFAULT '0',
	"unrealized_pnl" numeric(24, 8) DEFAULT '0',
	"margin_used" numeric(24, 8) DEFAULT '0',
	"notional_value" numeric(24, 8) DEFAULT '0',
	"snapshot_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_snapshots" ADD CONSTRAINT "account_snapshots_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_as_key_time" ON "account_snapshots" USING btree ("api_key_id","snapshot_at");