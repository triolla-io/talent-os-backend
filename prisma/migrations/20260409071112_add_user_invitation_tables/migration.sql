-- CreateTable: users
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "auth_provider" TEXT NOT NULL,
    "organization_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "full_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "provider_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable: invitations
CREATE TABLE "invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ NOT NULL,
    "invited_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique token on invitations
CREATE UNIQUE INDEX "invitations_token_key" ON "invitations"("token");

-- CreateIndex: composite index on invitations (organization_id, email, status)
CREATE INDEX "idx_invitations_org_email_status" ON "invitations"("organization_id", "email", "status");

-- CreateIndex: unique (organization_id, email) on users
CREATE UNIQUE INDEX "idx_users_org_email" ON "users"("organization_id", "email");

-- CreateIndex: index on users (organization_id)
CREATE INDEX "idx_users_org" ON "users"("organization_id");

-- AddForeignKey: users.organization_id → tenants.id
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: invitations.organization_id → tenants.id
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: invitations.invited_by_user_id → users.id
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: tenants.created_by_user_id → users.id (OrgCreator relation)
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex: unique created_by_user_id on tenants
CREATE UNIQUE INDEX "tenants_created_by_user_id_key" ON "tenants"("created_by_user_id");

-- CHECK constraints (Prisma does not support these natively — added manually per CLAUDE.md convention)
ALTER TABLE "users"
  ADD CONSTRAINT "users_role_check"
    CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  ADD CONSTRAINT "users_auth_provider_check"
    CHECK (auth_provider IN ('google', 'magic_link'));

ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_role_check"
    CHECK (role IN ('admin', 'member', 'viewer')),
  ADD CONSTRAINT "invitations_status_check"
    CHECK (status IN ('pending', 'accepted', 'expired'));
