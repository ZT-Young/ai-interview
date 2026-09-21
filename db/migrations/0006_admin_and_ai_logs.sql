CREATE TABLE "ai_call_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"operation" varchar(40) NOT NULL,
	"model" varchar(100),
	"status" varchar(16) NOT NULL,
	"duration_ms" integer,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"session_id" uuid,
	"error_code" varchar(40),
	"error_message" text,
	"prompt_version" varchar(30),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_call_logs" ADD CONSTRAINT "ai_call_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_call_logs_created_idx" ON "ai_call_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_call_logs_status_idx" ON "ai_call_logs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "ai_call_logs_operation_idx" ON "ai_call_logs" USING btree ("operation","created_at");--> statement-breakpoint
CREATE INDEX "ai_call_logs_user_idx" ON "ai_call_logs" USING btree ("user_id","created_at");