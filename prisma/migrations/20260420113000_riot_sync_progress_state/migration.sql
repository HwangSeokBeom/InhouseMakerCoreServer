ALTER TABLE "riot_accounts"
ADD COLUMN "sync_phase" TEXT,
ADD COLUMN "last_sync_progress_at" TIMESTAMP(3),
ADD COLUMN "processed_match_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "queued_match_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "has_usable_snapshot" BOOLEAN NOT NULL DEFAULT false;
