-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RECRUITING_APPLIED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RECRUITING_APPLICATION_CANCELLED';

-- CreateEnum
CREATE TYPE "RiotSyncStatus" AS ENUM ('IDLE', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'RETRY_SCHEDULED');

-- AlterTable
ALTER TABLE "riot_accounts"
ADD COLUMN "sync_status" "RiotSyncStatus" NOT NULL DEFAULT 'IDLE',
ADD COLUMN "last_sync_requested_at" TIMESTAMP(3),
ADD COLUMN "last_sync_succeeded_at" TIMESTAMP(3),
ADD COLUMN "last_sync_failed_at" TIMESTAMP(3),
ADD COLUMN "last_sync_error_code" TEXT,
ADD COLUMN "last_sync_error_message" TEXT;

-- CreateTable
CREATE TABLE "recruiting_post_applications" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recruiting_post_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "riot_accounts_sync_status_last_sync_requested_at_idx" ON "riot_accounts"("sync_status", "last_sync_requested_at");

-- CreateIndex
CREATE UNIQUE INDEX "recruiting_post_applications_post_id_user_id_key" ON "recruiting_post_applications"("post_id", "user_id");

-- CreateIndex
CREATE INDEX "recruiting_post_applications_post_id_created_at_idx" ON "recruiting_post_applications"("post_id", "created_at");

-- CreateIndex
CREATE INDEX "recruiting_post_applications_user_id_created_at_idx" ON "recruiting_post_applications"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "recruiting_post_applications"
ADD CONSTRAINT "recruiting_post_applications_post_id_fkey"
FOREIGN KEY ("post_id") REFERENCES "recruiting_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruiting_post_applications"
ADD CONSTRAINT "recruiting_post_applications_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
