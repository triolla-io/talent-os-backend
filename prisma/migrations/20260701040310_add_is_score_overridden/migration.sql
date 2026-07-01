-- AlterTable
ALTER TABLE "candidates" ADD COLUMN     "is_score_overridden" BOOLEAN NOT NULL DEFAULT false;

-- RenameIndex
ALTER INDEX "idx_scores_unique_per_app" RENAME TO "candidate_job_scores_tenant_id_application_id_key";
