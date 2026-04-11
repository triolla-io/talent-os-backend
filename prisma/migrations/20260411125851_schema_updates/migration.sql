-- DropIndex
DROP INDEX "idx_candidates_full_name_trgm";

-- DropIndex
DROP INDEX "idx_candidates_phone_trgm";

-- AlterTable
ALTER TABLE "invitations" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "tenants" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "updated_at" DROP DEFAULT;

-- RenameIndex
ALTER INDEX "idx_users_org_email" RENAME TO "users_organization_id_email_key";
