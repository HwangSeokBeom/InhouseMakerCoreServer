DROP TABLE IF EXISTS "email_verifications";

ALTER TABLE "users"
DROP COLUMN IF EXISTS "email_verified_at";

ALTER TABLE "auth_identities"
DROP COLUMN IF EXISTS "password_hash";

DROP TYPE IF EXISTS "EmailVerificationPurpose";
