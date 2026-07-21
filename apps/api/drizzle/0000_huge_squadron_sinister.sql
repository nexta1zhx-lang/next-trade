CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"exchange_id" varchar(30) NOT NULL,
	"account_label" varchar(50) DEFAULT '',
	"api_key" text NOT NULL,
	"secret_enc" text NOT NULL,
	"passphrase_enc" text,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"is_testnet" integer DEFAULT 0,
	"last_sync_at" timestamp,
	"last_trade_id" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_pnl_summary" (
	"user_id" integer NOT NULL,
	"date" varchar(10) NOT NULL,
	"realized_pnl" numeric(24, 8) DEFAULT '0',
	"fee_total" numeric(24, 8) DEFAULT '0',
	"trade_count" integer DEFAULT 0,
	"win_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"api_key_id" integer NOT NULL,
	"trade_id" varchar(100) NOT NULL,
	"symbol" varchar(30) NOT NULL,
	"market_type" varchar(20) NOT NULL,
	"side" varchar(20) NOT NULL,
	"price" numeric(24, 8) NOT NULL,
	"amount" numeric(24, 8) NOT NULL,
	"quote_qty" numeric(24, 8) NOT NULL,
	"realized_pnl" numeric(24, 8) DEFAULT '0',
	"fee_usdt" numeric(24, 8) DEFAULT '0',
	"is_liquidation" boolean DEFAULT false,
	"executed_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(50) NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "contract_volatility_rank" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" varchar(10) NOT NULL,
	"exchange" varchar(10) NOT NULL,
	"symbol" varchar(30) NOT NULL,
	"base" varchar(20) NOT NULL,
	"rank" integer NOT NULL,
	"open" numeric(20, 8) NOT NULL,
	"high" numeric(20, 8) NOT NULL,
	"low" numeric(20, 8) NOT NULL,
	"close" numeric(20, 8) NOT NULL,
	"amplitude" numeric(10, 2) NOT NULL,
	"body_range" numeric(10, 2) NOT NULL,
	"upper_wick" numeric(10, 2) NOT NULL,
	"lower_wick" numeric(10, 2) NOT NULL,
	"change" numeric(10, 2) NOT NULL,
	"quote_volume" numeric(24, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(30) NOT NULL,
	"record_date" varchar(10) NOT NULL,
	"rank" numeric(3, 0) NOT NULL,
	"last_price" numeric(20, 8) NOT NULL,
	"day_high" numeric(20, 8) NOT NULL,
	"day_low" numeric(20, 8) NOT NULL,
	"vwap" numeric(20, 8) NOT NULL,
	"fib_0382" numeric(20, 8) NOT NULL,
	"fib_0618" numeric(20, 8) NOT NULL,
	"atr" numeric(20, 8) NOT NULL,
	"amplitude" numeric(10, 2) NOT NULL,
	"quote_volume" numeric(24, 2) NOT NULL,
	"is_squeeze" boolean DEFAULT false NOT NULL,
	"score" numeric(8, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_pnl_summary" ADD CONSTRAINT "daily_pnl_summary_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ak_user" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_dps_user_date" ON "daily_pnl_summary" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_trades_ak_trade" ON "trades" USING btree ("api_key_id","trade_id");--> statement-breakpoint
CREATE INDEX "idx_trades_ak" ON "trades" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "idx_trades_exec" ON "trades" USING btree ("executed_at");--> statement-breakpoint
CREATE INDEX "idx_trades_symbol" ON "trades" USING btree ("symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_vol_date_exchange_symbol" ON "contract_volatility_rank" USING btree ("date","exchange","symbol");--> statement-breakpoint
CREATE INDEX "idx_vol_date_exchange_rank" ON "contract_volatility_rank" USING btree ("date","exchange","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_watchlist_date_symbol" ON "watchlist_snapshots" USING btree ("record_date","symbol");