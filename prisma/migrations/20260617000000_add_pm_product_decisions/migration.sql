-- CreateTable
CREATE TABLE "pm_product_decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "statement" TEXT NOT NULL,
    "context_route" TEXT,
    "created_by" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "superseded_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "pm_product_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_pm_decisions_tenant_status" ON "pm_product_decisions"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "pm_product_decisions" ADD CONSTRAINT "pm_product_decisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraint: status must be 'active' or 'superseded' (project convention: text + CHECK over PostgreSQL ENUMs)
ALTER TABLE "pm_product_decisions" ADD CONSTRAINT "pm_product_decisions_status_check" CHECK (status IN ('active', 'superseded'));
