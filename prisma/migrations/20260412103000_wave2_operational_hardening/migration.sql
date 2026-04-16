-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RESULT_DISPUTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RECRUITING_POSTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RESULT_ADMIN_RESOLVED';

-- AlterTable
ALTER TABLE "users"
ADD COLUMN "is_admin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "inhouse_match_results"
ADD COLUMN "admin_resolved_by_id" TEXT,
ADD COLUMN "admin_resolution_note" TEXT,
ADD COLUMN "admin_resolved_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_type_created_at_idx" ON "notifications"("user_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "inhouse_match_results_admin_resolved_by_id_admin_resolved_at_idx" ON "inhouse_match_results"("admin_resolved_by_id", "admin_resolved_at");

-- AddForeignKey
ALTER TABLE "inhouse_match_results"
ADD CONSTRAINT "inhouse_match_results_admin_resolved_by_id_fkey"
FOREIGN KEY ("admin_resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
