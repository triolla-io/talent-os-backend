-- DropIndex
DROP INDEX "idx_candidates_name_trgm";

-- DropIndex
DROP INDEX "idx_candidates_phone_trgm";

-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "job_stage_id" UUID;

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "exp_years_max" SMALLINT,
ADD COLUMN     "exp_years_min" SMALLINT,
ADD COLUMN     "must_have_skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "nice_to_have_skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "preferred_org_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "responsibilities" TEXT,
ADD COLUMN     "role_summary" TEXT,
ADD COLUMN     "what_we_offer" TEXT;

-- CreateTable
CREATE TABLE "job_stages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order" SMALLINT NOT NULL,
    "responsible_user_id" TEXT,
    "is_custom" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "job_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screening_questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "answer_type" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "knockout" BOOLEAN NOT NULL DEFAULT false,
    "order" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "screening_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_job_stages_job_order" ON "job_stages"("job_id", "order");

-- CreateIndex
CREATE INDEX "idx_screening_questions_job" ON "screening_questions"("job_id");

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_stage_id_fkey" FOREIGN KEY ("job_stage_id") REFERENCES "job_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_stages" ADD CONSTRAINT "job_stages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_stages" ADD CONSTRAINT "job_stages_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_questions" ADD CONSTRAINT "screening_questions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_questions" ADD CONSTRAINT "screening_questions_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
