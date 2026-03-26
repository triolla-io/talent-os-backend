-- AddColumn job_id to candidates (nullable to support email intake flow where job is not yet assigned)
ALTER TABLE "candidates" ADD COLUMN "job_id" UUID;

-- CreateIndex on tenant_id, job_id for query efficiency
CREATE INDEX "idx_candidates_tenant_job" ON "candidates"("tenant_id", "job_id");

-- AddForeignKey job_id -> jobs(id) with SET NULL on delete (preserves history when job is archived)
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
