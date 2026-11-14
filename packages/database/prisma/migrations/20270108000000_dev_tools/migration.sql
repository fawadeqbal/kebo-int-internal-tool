-- Dev tools (platform admin): the API's requests a minute at a time, and each unexpected error once.
-- Platform tables: not granted to kebo_app.

-- CreateTable
CREATE TABLE "request_minutes" (
    "minute" TIMESTAMPTZ NOT NULL,
    "route" VARCHAR(160) NOT NULL,
    "count" INTEGER NOT NULL,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "total_ms" BIGINT NOT NULL,
    "buckets" INTEGER[],

    CONSTRAINT "request_minutes_pkey" PRIMARY KEY ("minute","route")
);

-- CreateTable
CREATE TABLE "app_errors" (
    "id" UUID NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'api',
    "name" VARCHAR(120) NOT NULL,
    "message" TEXT NOT NULL,
    "where" VARCHAR(200) NOT NULL,
    "stack" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "company_name" VARCHAR(120),
    "user_name" VARCHAR(120),
    "path" VARCHAR(300),
    "first_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(10) NOT NULL DEFAULT 'open',
    "fixed_at" TIMESTAMPTZ,

    CONSTRAINT "app_errors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "request_minutes_route_minute_idx" ON "request_minutes"("route", "minute");

-- CreateIndex
CREATE UNIQUE INDEX "app_errors_fingerprint_key" ON "app_errors"("fingerprint");

-- CreateIndex
CREATE INDEX "app_errors_last_at_idx" ON "app_errors"("last_at");
