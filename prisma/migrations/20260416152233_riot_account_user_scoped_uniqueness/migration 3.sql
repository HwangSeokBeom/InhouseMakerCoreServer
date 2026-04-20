DROP INDEX IF EXISTS "riot_accounts_puuid_key";

CREATE UNIQUE INDEX "riot_accounts_user_id_puuid_key"
ON "riot_accounts"("user_id", "puuid");
