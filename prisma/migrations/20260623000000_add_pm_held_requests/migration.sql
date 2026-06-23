-- CreateTable
CREATE TABLE "pm_held_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "raw_text" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "conversation" JSONB NOT NULL,
    "brief" JSONB NOT NULL,
    "verdict" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_by" TEXT NOT NULL,
    "jira_keys" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "pm_held_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_pm_held_tenant_status" ON "pm_held_requests"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "pm_held_requests" ADD CONSTRAINT "pm_held_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraint: status must be one of the allowed values (project convention: text + CHECK over PostgreSQL ENUMs)
ALTER TABLE "pm_held_requests" ADD CONSTRAINT "pm_held_requests_status_check" CHECK (status IN ('pending', 'approved', 'rejected'));
