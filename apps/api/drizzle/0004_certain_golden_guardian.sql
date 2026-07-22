CREATE TABLE "symbol_journals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"symbol" varchar(30) NOT NULL,
	"date" varchar(10) NOT NULL,
	"title" varchar(200) DEFAULT '',
	"content" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "symbol_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"symbol" varchar(30) NOT NULL,
	"tag" varchar(50) NOT NULL,
	"color" varchar(7) DEFAULT '#3b82f6',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "symbol_journals" ADD CONSTRAINT "symbol_journals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "symbol_tags" ADD CONSTRAINT "symbol_tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sj_user_symbol_date" ON "symbol_journals" USING btree ("user_id","symbol","date");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_st_user_symbol_tag" ON "symbol_tags" USING btree ("user_id","symbol","tag");