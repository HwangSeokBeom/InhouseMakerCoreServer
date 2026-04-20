ALTER TABLE "riot_accounts"
ADD COLUMN "match_history_next_start" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "match_history_complete" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "riot_match_participant_summaries" (
    "id" TEXT NOT NULL,
    "riot_match_id" TEXT NOT NULL,
    "puuid" TEXT NOT NULL,
    "queue_id" INTEGER,
    "queue_category" TEXT NOT NULL,
    "game_mode" TEXT,
    "game_type" TEXT,
    "map_id" INTEGER,
    "played_at" TIMESTAMP(3) NOT NULL,
    "season_key" TEXT NOT NULL,
    "champion_id" INTEGER,
    "champion_key" TEXT,
    "champion_name" TEXT,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "deaths" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "did_win" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "riot_match_participant_summaries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "riot_match_participant_summaries_riot_match_id_puuid_key"
ON "riot_match_participant_summaries"("riot_match_id", "puuid");

CREATE INDEX "riot_match_participant_summaries_puuid_played_at_idx"
ON "riot_match_participant_summaries"("puuid", "played_at");

CREATE INDEX "riot_match_participant_summaries_puuid_season_key_idx"
ON "riot_match_participant_summaries"("puuid", "season_key");

CREATE INDEX "riot_match_participant_summaries_puuid_champion_id_played_at_idx"
ON "riot_match_participant_summaries"("puuid", "champion_id", "played_at");

CREATE INDEX "riot_match_participant_summaries_puuid_champion_key_played_at_idx"
ON "riot_match_participant_summaries"("puuid", "champion_key", "played_at");
