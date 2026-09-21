CREATE TYPE "public"."message_role" AS ENUM('ai', 'user', 'system');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('question', 'follow_up', 'hint', 'answer', 'skip', 'system');--> statement-breakpoint
CREATE TYPE "public"."orchestration_phase" AS ENUM('IDLE', 'PARSING', 'READY', 'ASKING', 'WAITING_ANSWER', 'FOLLOW_UP', 'NEXT_QUESTION', 'FINISHED', 'REPORTING');--> statement-breakpoint
CREATE TABLE "interview_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"question_id" uuid,
	"role" "message_role" NOT NULL,
	"type" "message_type" NOT NULL,
	"content" text NOT NULL,
	"follow_up_reason" varchar(20),
	"focus" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "phase" "orchestration_phase" DEFAULT 'IDLE' NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "current_question_id" uuid;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "phase_updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_messages" ADD CONSTRAINT "interview_messages_session_id_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."interview_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_messages" ADD CONSTRAINT "interview_messages_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interview_messages_session_created_idx" ON "interview_messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "interview_messages_question_idx" ON "interview_messages" USING btree ("question_id");