CREATE TYPE "public"."answer_source" AS ENUM('text', 'voice');--> statement-breakpoint
CREATE TYPE "public"."consent_type" AS ENUM('terms', 'privacy', 'ai_disclosure');--> statement-breakpoint
CREATE TYPE "public"."membership_level" AS ENUM('free', 'plus', 'pro');--> statement-breakpoint
CREATE TYPE "public"."parse_status" AS ENUM('pending', 'processing', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'paid', 'failed', 'refunded', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."question_source" AS ENUM('jd', 'resume', 'both', 'generic');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('self_intro', 'project_dig', 'technical', 'behavioral', 'reverse');--> statement-breakpoint
CREATE TYPE "public"."score_dimension" AS ENUM('job_match', 'professional', 'project_depth', 'logic', 'communication', 'motivation');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('draft', 'planned', 'in_progress', 'completed', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."unlock_type" AS ENUM('report', 'package', 'subscription');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" varchar(60) NOT NULL,
	"target_type" varchar(40),
	"target_id" uuid,
	"metadata" text DEFAULT '{}' NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"consent_type" "consent_type" NOT NULL,
	"version" varchar(20) NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" "inet"
);
--> statement-breakpoint
CREATE TABLE "evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"dimension_scores" jsonb NOT NULL,
	"question_score" numeric(4, 1) NOT NULL,
	"feedback" text NOT NULL,
	"evidence_quotes" jsonb NOT NULL,
	"ai_model" varchar(100),
	"prompt_version" varchar(30),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluations_question_score_range" CHECK ("evaluations"."question_score" >= 0 AND "evaluations"."question_score" <= 100),
	CONSTRAINT "evaluations_evidence_required" CHECK (jsonb_typeof("evaluations"."evidence_quotes") = 'array' AND jsonb_array_length("evaluations"."evidence_quotes") > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"name" varchar(100),
	"avatar_url" text,
	"membership" "membership_level" DEFAULT 'free' NOT NULL,
	"free_credits" integer DEFAULT 1 NOT NULL,
	"email_verified_at" timestamp with time zone,
	"terms_accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_free_credits_non_negative" CHECK ("users"."free_credits" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_expires_after_created" CHECK ("sessions"."expires_at" > "sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "resumes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_type" varchar(20) NOT NULL,
	"file_size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"raw_text" text,
	"parsed_data" jsonb,
	"parse_status" "parse_status" DEFAULT 'pending' NOT NULL,
	"parse_error" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "resumes_file_size_positive" CHECK ("resumes"."file_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "job_jds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(200),
	"company" varchar(200),
	"source_url" text,
	"raw_text" text NOT NULL,
	"parsed_data" jsonb,
	"parse_status" "parse_status" DEFAULT 'pending' NOT NULL,
	"parse_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"source" text DEFAULT 'text' NOT NULL,
	"audio_storage_key" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "answers_duration_non_negative" CHECK ("answers"."duration_ms" IS NULL OR "answers"."duration_ms" >= 0),
	CONSTRAINT "answers_source_valid" CHECK ("answers"."source" IN ('text', 'voice'))
);
--> statement-breakpoint
CREATE TABLE "interview_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"resume_id" uuid,
	"job_jd_id" uuid,
	"status" "session_status" DEFAULT 'draft' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"match_analysis" jsonb,
	"plan" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "sessions_finished_at_required" CHECK ("interview_sessions"."status" <> 'completed' OR "interview_sessions"."finished_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"parent_id" uuid,
	"root_id" uuid,
	"depth" smallint DEFAULT 0 NOT NULL,
	"order_index" smallint NOT NULL,
	"type" "question_type" NOT NULL,
	"source" "question_source" NOT NULL,
	"content" text NOT NULL,
	"intent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questions_depth_range" CHECK ("questions"."depth" >= 0 AND "questions"."depth" <= 2),
	CONSTRAINT "questions_depth_parent_consistent" CHECK (("questions"."depth" = 0 AND "questions"."parent_id" IS NULL) OR ("questions"."depth" > 0 AND "questions"."parent_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"total_score" numeric(5, 1) NOT NULL,
	"dimension_scores" jsonb NOT NULL,
	"highlights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reference_answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text,
	"is_unlocked" boolean DEFAULT false NOT NULL,
	"unlocked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_total_score_range" CHECK ("reports"."total_score" >= 0 AND "reports"."total_score" <= 100),
	CONSTRAINT "reports_highlights_array" CHECK (jsonb_typeof("reports"."highlights") = 'array'),
	CONSTRAINT "reports_issues_array" CHECK (jsonb_typeof("reports"."issues") = 'array'),
	CONSTRAINT "reports_reference_answers_array" CHECK (jsonb_typeof("reports"."reference_answers") = 'array'),
	CONSTRAINT "reports_next_steps_array" CHECK (jsonb_typeof("reports"."next_steps") = 'array')
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"report_id" uuid,
	"unlock_type" "unlock_type" NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'CNY' NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"provider" text,
	"provider_order_id" text,
	"credits_granted" integer DEFAULT 0 NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_non_negative" CHECK ("payments"."amount_cents" >= 0),
	CONSTRAINT "payments_credits_non_negative" CHECK ("payments"."credits_granted" >= 0),
	CONSTRAINT "payments_report_required_for_report_unlock" CHECK ("payments"."unlock_type" <> 'report' OR "payments"."report_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_session_id_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."interview_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_jds" ADD CONSTRAINT "job_jds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_job_jd_id_job_jds_id_fk" FOREIGN KEY ("job_jd_id") REFERENCES "public"."job_jds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_session_id_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."interview_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_parent_id_questions_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_root_id_questions_id_fk" FOREIGN KEY ("root_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_session_id_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."interview_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "consents_user_type_version_unique" ON "consents" USING btree ("user_id","consent_type","version");--> statement-breakpoint
CREATE UNIQUE INDEX "evaluations_question_unique" ON "evaluations" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "evaluations_session_idx" ON "evaluations" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email") WHERE "users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "users_membership_idx" ON "users" USING btree ("membership");--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "resumes_user_id_idx" ON "resumes" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "resumes_parse_status_idx" ON "resumes" USING btree ("parse_status");--> statement-breakpoint
CREATE UNIQUE INDEX "resumes_user_primary_unique" ON "resumes" USING btree ("user_id") WHERE "resumes"."is_primary" AND "resumes"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "job_jds_user_id_idx" ON "job_jds" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "job_jds_parse_status_idx" ON "job_jds" USING btree ("parse_status");--> statement-breakpoint
CREATE UNIQUE INDEX "answers_question_unique" ON "answers" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "answers_user_idx" ON "answers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_status_idx" ON "interview_sessions" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_created_idx" ON "interview_sessions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "questions_session_order_unique" ON "questions" USING btree ("session_id","order_index");--> statement-breakpoint
CREATE INDEX "questions_session_idx" ON "questions" USING btree ("session_id","order_index");--> statement-breakpoint
CREATE INDEX "questions_root_idx" ON "questions" USING btree ("root_id","depth");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_session_unique" ON "reports" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "reports_user_idx" ON "reports" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_order_unique" ON "payments" USING btree ("provider","provider_order_id") WHERE "payments"."provider_order_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_report_unlock_unique" ON "payments" USING btree ("report_id") WHERE "payments"."unlock_type" = 'report' AND "payments"."status" = 'paid';--> statement-breakpoint
CREATE INDEX "payments_user_idx" ON "payments" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");