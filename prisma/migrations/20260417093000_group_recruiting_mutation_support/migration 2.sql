ALTER TABLE "inhouse_groups"
ADD COLUMN "region" TEXT,
ADD COLUMN "archived_at" TIMESTAMP(3);

ALTER TABLE "recruiting_posts"
ADD COLUMN "deleted_at" TIMESTAMP(3);

CREATE INDEX "inhouse_groups_archived_at_idx"
ON "inhouse_groups"("archived_at");

CREATE INDEX "inhouse_groups_region_archived_at_idx"
ON "inhouse_groups"("region", "archived_at");

CREATE INDEX "recruiting_posts_deleted_at_idx"
ON "recruiting_posts"("deleted_at");
