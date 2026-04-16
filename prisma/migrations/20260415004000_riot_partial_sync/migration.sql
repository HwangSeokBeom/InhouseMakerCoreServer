ALTER TYPE "RiotSyncStatus" ADD VALUE IF NOT EXISTS 'PARTIAL';

ALTER TABLE "riot_accounts"
ADD COLUMN "profile_icon_id" INTEGER,
ADD COLUMN "summoner_level" INTEGER,
ADD COLUMN "summoner_revision_date" TIMESTAMP(3),
ADD COLUMN "last_sync_warning_code" TEXT,
ADD COLUMN "last_sync_warning_message" TEXT;
