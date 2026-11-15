-- Time and dates per company: its time zone (null: the server's) and how it writes dates and times.
-- A person no longer has a time zone of their own: every time in a company is the company's.
ALTER TABLE "companies" ADD COLUMN "time_zone" VARCHAR(60);
ALTER TABLE "companies" ADD COLUMN "date_format" VARCHAR(12) NOT NULL DEFAULT 'd_mmm_yyyy';
ALTER TABLE "companies" ADD COLUMN "time_format" VARCHAR(3) NOT NULL DEFAULT '24h';

ALTER TABLE "users" DROP COLUMN "time_zone";
