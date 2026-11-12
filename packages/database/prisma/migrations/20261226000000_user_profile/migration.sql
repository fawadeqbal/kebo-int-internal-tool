-- My account (board): a person's own phone, language and time zone.
ALTER TABLE "users" ADD COLUMN "phone" VARCHAR(40);
ALTER TABLE "users" ADD COLUMN "language" VARCHAR(10) NOT NULL DEFAULT 'en';
ALTER TABLE "users" ADD COLUMN "time_zone" VARCHAR(60);
