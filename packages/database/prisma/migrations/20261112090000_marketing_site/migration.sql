-- The marketing site: its words (edited from the platform panel), visits counted without cookies,
-- and where each lead came from. Platform tables: not granted to kebo_app.

ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'contact';

ALTER TABLE "leads" ADD COLUMN "channel" VARCHAR(80), ADD COLUMN "origin" JSONB;
CREATE INDEX "leads_channel_idx" ON "leads"("channel");

ALTER TABLE "sign_ups" ADD COLUMN "origin" JSONB;

CREATE TABLE "site_content" (
    "key" VARCHAR(40) NOT NULL,
    "draft" JSONB NOT NULL,
    "published" JSONB,
    "published_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" VARCHAR(120),
    CONSTRAINT "site_content_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "site_visits" (
    "day" DATE NOT NULL,
    "channel" VARCHAR(80) NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "visitors" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "site_visits_pkey" PRIMARY KEY ("day", "channel")
);

CREATE TABLE "site_visitor_marks" (
    "day" DATE NOT NULL,
    "hash" CHAR(32) NOT NULL,
    CONSTRAINT "site_visitor_marks_pkey" PRIMARY KEY ("day", "hash")
);
