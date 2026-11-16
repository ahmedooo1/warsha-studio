CREATE TYPE "public"."quote_event_type" AS ENUM('sent', 'accepted', 'cancelled', 'replaced');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'staff');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity" text DEFAULT '' NOT NULL,
	"entity_id" text DEFAULT '' NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"rev" integer NOT NULL,
	"kind" text NOT NULL,
	"change_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"user_id" uuid,
	"device" text DEFAULT '' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"rev" integer NOT NULL,
	"seq" bigint NOT NULL,
	"name" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"variant" text,
	"cfg" jsonb NOT NULL,
	"thumb" text DEFAULT '' NOT NULL,
	"client_updated_at" bigint DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"updated_by" uuid,
	"device" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"type" "quote_event_type" NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"year" integer NOT NULL,
	"seq_no" integer NOT NULL,
	"project_id" text NOT NULL,
	"project_rev" integer NOT NULL,
	"client_name" text DEFAULT '' NOT NULL,
	"client_phone" text DEFAULT '' NOT NULL,
	"currency" text DEFAULT '' NOT NULL,
	"total" text DEFAULT '0' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"pdf" "bytea",
	"pdf_sha256" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"device" text DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"rev" integer DEFAULT 0 NOT NULL,
	"seq" bigint DEFAULT 0 NOT NULL,
	"prices" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fab" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"project_id" text NOT NULL,
	"quote_id" uuid,
	"pin_hash" text,
	"failed_pins" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"views" integer DEFAULT 0 NOT NULL,
	"last_view_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"role" "user_role" DEFAULT 'staff' NOT NULL,
	"password_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_events" ADD CONSTRAINT "quote_events_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_events" ADD CONSTRAINT "quote_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "versions_project_idx" ON "project_versions" USING btree ("project_id","rev");--> statement-breakpoint
CREATE UNIQUE INDEX "versions_change_uq" ON "project_versions" USING btree ("change_id");--> statement-breakpoint
CREATE INDEX "projects_seq_idx" ON "projects" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "quote_events_q_idx" ON "quote_events" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_number_uq" ON "quotes" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_year_seq_uq" ON "quotes" USING btree ("year","seq_no");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "share_token_uq" ON "share_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "share_project_idx" ON "share_links" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");