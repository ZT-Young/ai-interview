-- 003: questions 表新增面试计划字段（docs/AI_PROMPTS.md §4.2）
--
-- 注意：dimension 为 NOT NULL 且业务上无合理默认值。
-- drizzle-kit 生成的原始语句是 `ADD COLUMN "dimension" ... NOT NULL`，
-- 这在**已有数据**的 questions 表上会直接失败（Postgres: column contains null values）。
-- 因此这里改为三步：先带临时默认值加列 → 去掉默认值，
-- 使新插入的行仍必须显式指定 dimension（保持 schema 的严格性）。

ALTER TABLE "questions" ADD COLUMN "dimension" "score_dimension" NOT NULL DEFAULT 'professional';--> statement-breakpoint
ALTER TABLE "questions" ALTER COLUMN "dimension" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "expected_points" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "follow_up_allowed" boolean DEFAULT true NOT NULL;
