ALTER TABLE "report_shares" DROP CONSTRAINT "report_shares_invite_needs_invitee";--> statement-breakpoint
ALTER TABLE "report_shares" ALTER COLUMN "session_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_active_needs_session" CHECK ("report_shares"."status" <> 'active' OR "report_shares"."session_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_invite_needs_invitee" CHECK ("report_shares"."kind" <> 'invite' OR "report_shares"."invitee_user_id" IS NOT NULL);