DO $$
BEGIN
    CREATE TYPE "AuthProvider" AS ENUM ('EMAIL', 'APPLE', 'GOOGLE');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "EmailVerificationPurpose" AS ENUM ('SIGNUP', 'RESET_PASSWORD');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN IF NOT EXISTS "email_verified_at" TIMESTAMP(3);

UPDATE "users"
SET "email_verified_at" = COALESCE("email_verified_at", "created_at")
WHERE "email_verified_at" IS NULL;

CREATE TABLE IF NOT EXISTS "auth_identities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "provider_user_id" TEXT NOT NULL,
    "email" TEXT,
    "password_hash" TEXT,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "email_verifications" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "purpose" "EmailVerificationPurpose" NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "verified_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_verifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "auth_identities_provider_provider_user_id_key"
ON "auth_identities"("provider", "provider_user_id");

CREATE UNIQUE INDEX IF NOT EXISTS "auth_identities_user_id_provider_key"
ON "auth_identities"("user_id", "provider");

CREATE INDEX IF NOT EXISTS "auth_identities_email_idx"
ON "auth_identities"("email");

CREATE INDEX IF NOT EXISTS "auth_identities_user_id_last_login_at_idx"
ON "auth_identities"("user_id", "last_login_at");

CREATE INDEX IF NOT EXISTS "email_verifications_email_purpose_created_at_idx"
ON "email_verifications"("email", "purpose", "created_at");

CREATE INDEX IF NOT EXISTS "email_verifications_email_purpose_consumed_at_idx"
ON "email_verifications"("email", "purpose", "consumed_at");

ALTER TABLE "auth_identities"
DROP CONSTRAINT IF EXISTS "auth_identities_user_id_fkey",
ADD CONSTRAINT "auth_identities_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "auth_identities" (
    "id",
    "user_id",
    "provider",
    "provider_user_id",
    "email",
    "password_hash",
    "linked_at",
    "last_login_at",
    "created_at",
    "updated_at"
)
SELECT
    CONCAT('legacy_email_', "id"),
    "id",
    'EMAIL'::"AuthProvider",
    LOWER("email"),
    "email",
    "password_hash",
    "created_at",
    "updated_at",
    "created_at",
    "updated_at"
FROM "users"
WHERE "password_hash" IS NOT NULL
ON CONFLICT ("provider", "provider_user_id") DO NOTHING;

INSERT INTO "auth_identities" (
    "id",
    "user_id",
    "provider",
    "provider_user_id",
    "email",
    "linked_at",
    "last_login_at",
    "created_at",
    "updated_at"
)
SELECT
    CONCAT('legacy_apple_', "id"),
    "id",
    'APPLE'::"AuthProvider",
    "apple_sub",
    "email",
    "created_at",
    "updated_at",
    "created_at",
    "updated_at"
FROM "users"
WHERE "apple_sub" IS NOT NULL
ON CONFLICT ("provider", "provider_user_id") DO NOTHING;

ALTER TABLE "users"
DROP COLUMN IF EXISTS "apple_sub",
DROP COLUMN IF EXISTS "password_hash";
