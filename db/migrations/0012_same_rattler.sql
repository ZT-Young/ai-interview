CREATE TYPE "public"."session_kind" AS ENUM('user', 'admin');--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "kind" "session_kind" DEFAULT 'user' NOT NULL;--> statement-breakpoint
CREATE INDEX "sessions_kind_idx" ON "sessions" USING btree ("kind");