ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "terms_agreed_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "privacy_agreed_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "marketing_opt_in_at" TIMESTAMP(3);

ALTER TABLE "auth_identities"
ADD COLUMN IF NOT EXISTS "password_hash" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "users_nickname_key"
ON "users"("nickname");
