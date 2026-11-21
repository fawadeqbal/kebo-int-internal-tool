-- The platform's own settings (Platform settings › Emails): its sending email and where its emails go.
-- A platform table: not granted to kebo_app.

CREATE TABLE "platform_settings" (
    "key" VARCHAR(40) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" VARCHAR(120),
    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);
