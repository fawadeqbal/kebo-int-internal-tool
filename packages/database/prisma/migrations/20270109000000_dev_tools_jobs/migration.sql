-- Dev tools (platform admin): worker job runs, and emails and phone notifications delivered or not.
-- Platform tables: not granted to kebo_app.

-- CreateTable
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL,
    "job" VARCHAR(60) NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "took_ms" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "result" VARCHAR(300),

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_days" (
    "day" DATE NOT NULL,
    "channel" VARCHAR(10) NOT NULL,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "delivery_days_pkey" PRIMARY KEY ("day","channel")
);

-- CreateTable
CREATE TABLE "delivery_failures" (
    "id" UUID NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" VARCHAR(10) NOT NULL,
    "what" VARCHAR(200) NOT NULL,
    "to" VARCHAR(120),
    "company_name" VARCHAR(120),
    "reason" VARCHAR(300) NOT NULL,

    CONSTRAINT "delivery_failures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_runs_job_started_at_idx" ON "job_runs"("job", "started_at");

-- CreateIndex
CREATE INDEX "job_runs_started_at_idx" ON "job_runs"("started_at");

-- CreateIndex
CREATE INDEX "delivery_failures_at_idx" ON "delivery_failures"("at");
