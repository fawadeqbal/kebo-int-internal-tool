-- Facts about this database that a backup keeps. pg_dump copies table rows but not
-- database settings (ALTER DATABASE … SET TimeZone), so the time zone fix of
-- 20261110090100_utc_timestamps is recorded here as a row: a dump that has the row
-- "utc_timestamps" holds UTC times. A dump without it is from before the fix and
-- must be brought up to date by the normal migrations (docs/restore.md), never by
-- running that migration's SQL by hand. Platform table: not granted to kebo_app.

-- CreateTable
CREATE TABLE "database_markers" (
    "key" VARCHAR(60) NOT NULL,
    "note" TEXT NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "database_markers_pkey" PRIMARY KEY ("key")
);

-- Migrations run in order, so the time zone fix has always been applied by now.
INSERT INTO "database_markers" ("key", "note")
VALUES ('utc_timestamps', 'Stored times are UTC (migration 20261110090100_utc_timestamps applied).')
ON CONFLICT ("key") DO NOTHING;

-- The three starting roles are made by a migration with the database's own clock,
-- which was right; on a database that ran in another time zone the time zone fix then
-- moved them hours into the future. Nothing is made in the future: bring those back
-- to now. Only rows in the future, so running it again (or on a UTC database) changes nothing.
UPDATE "roles" SET "created_at" = LEAST("created_at", now()), "updated_at" = LEAST("updated_at", now())
WHERE "created_at" > now() OR "updated_at" > now();
