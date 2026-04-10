-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Position" AS ENUM ('TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT', 'FILL');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('CLAIMED', 'GROUP_VERIFIED', 'ADMIN_VERIFIED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('DRAFT', 'RECRUITING', 'LOCKED', 'BALANCED', 'IN_PROGRESS', 'RESULT_PENDING', 'CONFIRMED', 'DISPUTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TeamSide" AS ENUM ('A', 'B');

-- CreateEnum
CREATE TYPE "ResultStatus" AS ENUM ('PARTIAL', 'CONFIRMED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "InputMode" AS ENUM ('QUICK', 'DETAILED');

-- CreateEnum
CREATE TYPE "RecruitingPostType" AS ENUM ('MEMBER_RECRUIT', 'OPPONENT_RECRUIT');

-- CreateEnum
CREATE TYPE "GroupRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "ParticipationStatus" AS ENUM ('INVITED', 'ACCEPTED', 'DECLINED', 'LOCKED_IN');

-- CreateEnum
CREATE TYPE "QueueType" AS ENUM ('SOLO_RANK', 'FLEX_RANK', 'ALL');

-- CreateEnum
CREATE TYPE "SnapshotType" AS ENUM ('RANKED', 'RECENT_MATCHES', 'MATCH_DETAIL', 'AGGREGATED');

-- CreateEnum
CREATE TYPE "LaneResult" AS ENUM ('WIN', 'EVEN', 'LOSE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ConfirmationAction" AS ENUM ('CONFIRM', 'SUGGEST_CHANGE', 'DISPUTE');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('RESULT_CONFIRMATION_REQUEST', 'GROUP_INVITE', 'RECRUITING_CLOSED', 'RESULT_CONFIRMED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "GroupVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "JoinPolicy" AS ENUM ('INVITE_ONLY', 'APPROVAL_REQUIRED', 'OPEN');

-- CreateEnum
CREATE TYPE "RecruitingPostStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BalanceMode" AS ENUM ('BALANCED', 'POSITION_FIRST', 'SKILL_FIRST');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "apple_sub" TEXT,
    "password_hash" TEXT,
    "refresh_token_hash" TEXT,
    "nickname" TEXT NOT NULL,
    "primary_position" "Position",
    "secondary_position" "Position",
    "is_fill_available" BOOLEAN NOT NULL DEFAULT false,
    "style_tags" JSONB,
    "manner_score" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "noshow_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "riot_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "riot_game_name" TEXT NOT NULL,
    "tag_line" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "puuid" TEXT NOT NULL,
    "summoner_id" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'CLAIMED',
    "last_synced_at" TIMESTAMP(3),
    "last_sync_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "riot_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "riot_account_snapshots" (
    "id" TEXT NOT NULL,
    "riot_account_id" TEXT NOT NULL,
    "snapshot_type" "SnapshotType" NOT NULL,
    "queue_type" "QueueType",
    "sample_size" INTEGER,
    "tier" TEXT,
    "rank" TEXT,
    "lp" INTEGER,
    "metrics_json" JSONB,
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "riot_account_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_power_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source_account_id" TEXT,
    "base_power" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "form_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "style_scores_json" JSONB,
    "inhouse_mmr" DOUBLE PRECISION NOT NULL DEFAULT 1500,
    "inhouse_confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lane_power_json" JSONB,
    "overall_power" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confirmed_match_count" INTEGER NOT NULL DEFAULT 0,
    "version" TEXT NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_power_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inhouse_groups" (
    "id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "GroupVisibility" NOT NULL DEFAULT 'PRIVATE',
    "join_policy" "JoinPolicy" NOT NULL DEFAULT 'INVITE_ONLY',
    "tags" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inhouse_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_members" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "GroupRole" NOT NULL DEFAULT 'MEMBER',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inhouse_matches" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "title" TEXT,
    "status" "MatchStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduled_at" TIMESTAMP(3),
    "balance_mode" "BalanceMode",
    "selected_candidate_no" INTEGER,
    "notes" TEXT,
    "candidates_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inhouse_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inhouse_match_players" (
    "id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "riot_account_id" TEXT,
    "team_side" "TeamSide",
    "assigned_role" "Position",
    "position_pref_snapshot" JSONB,
    "same_team_preferences_json" JSONB,
    "avoid_team_preferences_json" JSONB,
    "participation_status" "ParticipationStatus" NOT NULL DEFAULT 'INVITED',
    "is_captain" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inhouse_match_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inhouse_match_results" (
    "id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "winning_team" "TeamSide",
    "mvp_user_id" TEXT,
    "balance_rating" INTEGER,
    "result_status" "ResultStatus" NOT NULL DEFAULT 'PARTIAL',
    "input_mode" "InputMode" NOT NULL,
    "submitted_by" TEXT NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "notes" TEXT,
    "payload_json" JSONB,
    "idempotency_key" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inhouse_match_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inhouse_player_stats" (
    "id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "team_side" "TeamSide" NOT NULL,
    "role" "Position" NOT NULL,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "deaths" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "lane_result" "LaneResult" NOT NULL DEFAULT 'UNKNOWN',
    "contribution_rating" INTEGER,
    "stat_status" "ResultStatus" NOT NULL DEFAULT 'PARTIAL',
    "details_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inhouse_player_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiting_posts" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "post_type" "RecruitingPostType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "tags" JSONB,
    "scheduled_at" TIMESTAMP(3),
    "required_positions_json" JSONB,
    "status" "RecruitingPostStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recruiting_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_result_confirmations" (
    "id" TEXT NOT NULL,
    "match_result_id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "result_version" INTEGER NOT NULL DEFAULT 1,
    "action" "ConfirmationAction" NOT NULL,
    "diff_json" JSONB,
    "proposed_winning_team" "TeamSide",
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_result_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payload_json" JSONB,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "related_entity_type" TEXT,
    "related_entity_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before_json" JSONB,
    "after_json" JSONB,
    "meta_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_apple_sub_key" ON "users"("apple_sub");

-- CreateIndex
CREATE UNIQUE INDEX "riot_accounts_puuid_key" ON "riot_accounts"("puuid");

-- CreateIndex
CREATE INDEX "riot_accounts_user_id_is_primary_idx" ON "riot_accounts"("user_id", "is_primary");

-- CreateIndex
CREATE INDEX "riot_accounts_user_id_last_synced_at_idx" ON "riot_accounts"("user_id", "last_synced_at");

-- CreateIndex
CREATE INDEX "riot_account_snapshots_riot_account_id_collected_at_idx" ON "riot_account_snapshots"("riot_account_id", "collected_at");

-- CreateIndex
CREATE INDEX "riot_account_snapshots_snapshot_type_collected_at_idx" ON "riot_account_snapshots"("snapshot_type", "collected_at");

-- CreateIndex
CREATE UNIQUE INDEX "player_power_profiles_user_id_key" ON "player_power_profiles"("user_id");

-- CreateIndex
CREATE INDEX "player_power_profiles_calculated_at_idx" ON "player_power_profiles"("calculated_at");

-- CreateIndex
CREATE INDEX "inhouse_groups_owner_user_id_idx" ON "inhouse_groups"("owner_user_id");

-- CreateIndex
CREATE INDEX "group_members_user_id_role_idx" ON "group_members"("user_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "group_members_group_id_user_id_key" ON "group_members"("group_id", "user_id");

-- CreateIndex
CREATE INDEX "inhouse_matches_group_id_status_idx" ON "inhouse_matches"("group_id", "status");

-- CreateIndex
CREATE INDEX "inhouse_matches_group_id_scheduled_at_idx" ON "inhouse_matches"("group_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "inhouse_match_players_match_id_participation_status_idx" ON "inhouse_match_players"("match_id", "participation_status");

-- CreateIndex
CREATE INDEX "inhouse_match_players_user_id_participation_status_idx" ON "inhouse_match_players"("user_id", "participation_status");

-- CreateIndex
CREATE UNIQUE INDEX "inhouse_match_players_match_id_user_id_key" ON "inhouse_match_players"("match_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "inhouse_match_results_match_id_key" ON "inhouse_match_results"("match_id");

-- CreateIndex
CREATE INDEX "inhouse_match_results_result_status_created_at_idx" ON "inhouse_match_results"("result_status", "created_at");

-- CreateIndex
CREATE INDEX "inhouse_player_stats_user_id_created_at_idx" ON "inhouse_player_stats"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "inhouse_player_stats_match_id_user_id_key" ON "inhouse_player_stats"("match_id", "user_id");

-- CreateIndex
CREATE INDEX "recruiting_posts_group_id_status_scheduled_at_idx" ON "recruiting_posts"("group_id", "status", "scheduled_at");

-- CreateIndex
CREATE INDEX "match_result_confirmations_match_result_id_user_id_created__idx" ON "match_result_confirmations"("match_result_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "match_result_confirmations_match_id_created_at_idx" ON "match_result_confirmations"("match_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_status_created_at_idx" ON "notifications"("user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "riot_accounts" ADD CONSTRAINT "riot_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riot_account_snapshots" ADD CONSTRAINT "riot_account_snapshots_riot_account_id_fkey" FOREIGN KEY ("riot_account_id") REFERENCES "riot_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_power_profiles" ADD CONSTRAINT "player_power_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_power_profiles" ADD CONSTRAINT "player_power_profiles_source_account_id_fkey" FOREIGN KEY ("source_account_id") REFERENCES "riot_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inhouse_groups" ADD CONSTRAINT "inhouse_groups_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "inhouse_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inhouse_matches" ADD CONSTRAINT "inhouse_matches_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "inhouse_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inhouse_matches" ADD CONSTRAINT "inhouse_matches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inhouse_match_players" ADD CONSTRAINT "inhouse_match_players_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "inhouse_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inhouse_match_players" ADD CONSTRAINT "inhouse_match_players_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inhouse_match_players" ADD CONSTRAINT "inhouse_match_players_riot_account_id_fkey" FOREIGN KEY ("riot_account_id") REFERENCES "riot_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inhouse_match_results" ADD CONSTRAINT "inhouse_match_results_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "inhouse_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inhouse_match_results" ADD CONSTRAINT "inhouse_match_results_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inhouse_match_results" ADD CONSTRAINT "inhouse_match_results_mvp_user_id_fkey" FOREIGN KEY ("mvp_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inhouse_player_stats" ADD CONSTRAINT "inhouse_player_stats_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "inhouse_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inhouse_player_stats" ADD CONSTRAINT "inhouse_player_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruiting_posts" ADD CONSTRAINT "recruiting_posts_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "inhouse_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruiting_posts" ADD CONSTRAINT "recruiting_posts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_result_confirmations" ADD CONSTRAINT "match_result_confirmations_match_result_id_fkey" FOREIGN KEY ("match_result_id") REFERENCES "inhouse_match_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_result_confirmations" ADD CONSTRAINT "match_result_confirmations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_result_confirmations" ADD CONSTRAINT "match_result_confirmations_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "inhouse_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

