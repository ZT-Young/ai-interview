ALTER TYPE "public"."unlock_type" ADD VALUE 'free_trial';--> statement-breakpoint
CREATE TABLE "redemption_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"product_id" text NOT NULL,
	"max_usages" integer DEFAULT 1 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"disabled" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redemption_codes_used_within_max" CHECK ("redemption_codes"."used_count" >= 0 AND "redemption_codes"."used_count" <= "redemption_codes"."max_usages"),
	CONSTRAINT "redemption_codes_max_usages_positive" CHECK ("redemption_codes"."max_usages" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "redemption_codes_code_hash_unique" ON "redemption_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "redemption_codes_product_idx" ON "redemption_codes" USING btree ("product_id");