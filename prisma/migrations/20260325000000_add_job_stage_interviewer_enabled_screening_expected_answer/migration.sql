-- AlterTable: job_stages
-- Rename responsible_user_id to interviewer (safe migration: add, copy, drop)
ALTER TABLE "job_stages" ADD COLUMN "interviewer" TEXT;
UPDATE "job_stages" SET "interviewer" = "responsible_user_id" WHERE "responsible_user_id" IS NOT NULL;
ALTER TABLE "job_stages" DROP COLUMN "responsible_user_id";

-- Add is_enabled with default true (existing rows get is_enabled=true automatically)
ALTER TABLE "job_stages" ADD COLUMN "is_enabled" BOOLEAN NOT NULL DEFAULT true;

-- Add color with default bg-zinc-400 (existing rows get default color)
ALTER TABLE "job_stages" ADD COLUMN "color" TEXT NOT NULL DEFAULT 'bg-zinc-400';

-- AlterTable: screening_questions
-- Add expected_answer (nullable, no backfill needed)
ALTER TABLE "screening_questions" ADD COLUMN "expected_answer" TEXT;
