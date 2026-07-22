ALTER TABLE "contract_volatility_rank" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "watchlist_snapshots" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "contract_volatility_rank" CASCADE;--> statement-breakpoint
DROP TABLE "watchlist_snapshots" CASCADE;--> statement-breakpoint
ALTER TABLE "asset_snapshots" ADD COLUMN "is_reconstructed" boolean DEFAULT false;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_cf_unique" ON "capital_flows" USING btree ("api_key_id","occurred_at","flow_type");