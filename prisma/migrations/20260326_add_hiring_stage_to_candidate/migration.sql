-- Step 1: Add nullable column + FK constraint
-- Add hiring_stage_id column (nullable for data migration)
ALTER TABLE "candidates" ADD COLUMN "hiring_stage_id" UUID;

-- Add FK constraint to job_stages
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_hiring_stage_id_fkey"
  FOREIGN KEY ("hiring_stage_id") REFERENCES "job_stages"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Create index for Kanban board queries
CREATE INDEX "idx_candidates_tenant_job_stage"
  ON "candidates"("tenant_id", "job_id", "hiring_stage_id");

-- Step 2: Backfill existing data (non-blocking)
-- Assign first stage (lowest order) to candidates with job_id
UPDATE "candidates" c
SET "hiring_stage_id" = (
  SELECT id FROM "job_stages" js
  WHERE js."job_id" = c."job_id"
  ORDER BY js."order" ASC
  LIMIT 1
)
WHERE c."job_id" IS NOT NULL
  AND c."hiring_stage_id" IS NULL;

-- Step 3: Add CHECK constraint (data integrity)
-- Enforce: if job_id is NOT NULL, then hiring_stage_id must also be NOT NULL
ALTER TABLE "candidates"
ADD CONSTRAINT "check_hiring_stage_when_job_assigned"
CHECK (("job_id" IS NULL) OR ("hiring_stage_id" IS NOT NULL));
