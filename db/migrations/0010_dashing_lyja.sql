CREATE TYPE "public"."share_kind" AS ENUM('link', 'invite');--> statement-breakpoint
CREATE TYPE "public"."share_status" AS ENUM('pending', 'active', 'declined', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."share_visibility" AS ENUM('summary', 'full');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('candidate', 'interviewer');--> statement-breakpoint
CREATE TABLE "report_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"kind" "share_kind" NOT NULL,
	"status" "share_status" NOT NULL,
	"token_hash" text,
	"invitee_user_id" uuid,
	"invitee_identifier" varchar(255),
	"visibility" "share_visibility" DEFAULT 'summary' NOT NULL,
	"note" varchar(200),
	"access_code_hash" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_shares_view_count_non_negative" CHECK ("report_shares"."view_count" >= 0),
	CONSTRAINT "report_shares_link_needs_token" CHECK ("report_shares"."kind" <> 'link' OR "report_shares"."token_hash" IS NOT NULL),
	CONSTRAINT "report_shares_invite_needs_invitee" CHECK ("report_shares"."kind" <> 'invite' OR "report_shares"."invitee_identifier" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" "user_role" DEFAULT 'candidate' NOT NULL;--> statement-breakpoint
ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_session_id_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."interview_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_invitee_user_id_users_id_fk" FOREIGN KEY ("invitee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_shares_token_unique" ON "report_shares" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "report_shares_owner_idx" ON "report_shares" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "report_shares_invitee_idx" ON "report_shares" USING btree ("invitee_user_id","created_at");