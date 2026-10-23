ALTER TABLE "queries" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "queries" ALTER COLUMN "status" SET DEFAULT 'pending'::text;--> statement-breakpoint
ALTER TABLE "query_status_history" ALTER COLUMN "from_status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "query_status_history" ALTER COLUMN "to_status" SET DATA TYPE text;--> statement-breakpoint
-- "On Hold" is no longer a status: anything on hold goes back to Processing.
UPDATE "queries" SET "status" = 'processing' WHERE "status" = 'on_hold';--> statement-breakpoint
UPDATE "query_status_history" SET "from_status" = 'processing' WHERE "from_status" = 'on_hold';--> statement-breakpoint
UPDATE "query_status_history" SET "to_status" = 'processing' WHERE "to_status" = 'on_hold';--> statement-breakpoint
DROP TYPE "public"."query_status";--> statement-breakpoint
CREATE TYPE "public"."query_status" AS ENUM('pending', 'processing', 'completed', 'not_completed');--> statement-breakpoint
ALTER TABLE "queries" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."query_status";--> statement-breakpoint
ALTER TABLE "queries" ALTER COLUMN "status" SET DATA TYPE "public"."query_status" USING "status"::"public"."query_status";--> statement-breakpoint
ALTER TABLE "query_status_history" ALTER COLUMN "from_status" SET DATA TYPE "public"."query_status" USING "from_status"::"public"."query_status";--> statement-breakpoint
ALTER TABLE "query_status_history" ALTER COLUMN "to_status" SET DATA TYPE "public"."query_status" USING "to_status"::"public"."query_status";--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "company_name" DROP NOT NULL;