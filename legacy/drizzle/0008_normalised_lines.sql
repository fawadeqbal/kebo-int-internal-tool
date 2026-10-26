-- Normalised documents: requested items per inquiry, shared line columns,
-- every line linked to the line it came from, frozen currency/party details,
-- one packing list per invoice, and database-checked inquiry/customer links.

-- 1. Requested items (what the customer asked for), filled from each inquiry's title and quantity.
CREATE TABLE "query_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query_id" uuid NOT NULL,
	"description" text NOT NULL,
	"model" varchar(120),
	"quantity" numeric(12, 2) NOT NULL,
	"unit" varchar(20) DEFAULT 'pcs' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "query_items" ADD CONSTRAINT "query_items_query_id_queries_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."queries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "query_items_query_idx" ON "query_items" USING btree ("query_id");--> statement-breakpoint
INSERT INTO "query_items" ("query_id", "description", "quantity", "unit", "sort_order")
  SELECT "id", "title", GREATEST("quantity", 1), 'pcs', 0 FROM "queries";--> statement-breakpoint
ALTER TABLE "queries" ALTER COLUMN "specifications" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "queries" DROP COLUMN "quantity";--> statement-breakpoint

-- 2. Shared line columns and links back to the line each one came from.
ALTER TABLE "quotation_items" ADD COLUMN "query_item_id" uuid;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD COLUMN "model" varchar(120);--> statement-breakpoint
ALTER TABLE "quotation_items" ADD COLUMN "unit" varchar(20) DEFAULT 'pcs' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD COLUMN "hs_code" varchar(20);--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "quotation_item_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "model" varchar(120);--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "unit" varchar(20) DEFAULT 'pcs' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "hs_code" varchar(20);--> statement-breakpoint
ALTER TABLE "packing_list_items" ADD COLUMN "invoice_item_id" uuid;--> statement-breakpoint
ALTER TABLE "packing_list_items" ADD COLUMN "model" varchar(120);--> statement-breakpoint
ALTER TABLE "packing_list_items" ADD COLUMN "hs_code" varchar(20);--> statement-breakpoint
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_query_item_id_query_items_id_fk" FOREIGN KEY ("query_item_id") REFERENCES "public"."query_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_quotation_item_id_quotation_items_id_fk" FOREIGN KEY ("quotation_item_id") REFERENCES "public"."quotation_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_list_items" ADD CONSTRAINT "packing_list_items_invoice_item_id_invoice_items_id_fk" FOREIGN KEY ("invoice_item_id") REFERENCES "public"."invoice_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quotation_items_quotation_idx" ON "quotation_items" USING btree ("quotation_id");--> statement-breakpoint
CREATE INDEX "invoice_items_invoice_idx" ON "invoice_items" USING btree ("invoice_id");--> statement-breakpoint
-- Existing data: the first quotation line answers the inquiry's (single) item;
-- invoice and packing lines are matched to their source line by position and text.
UPDATE "quotation_items" qi SET "query_item_id" = it."id"
  FROM "quotations" q, "query_items" it
  WHERE qi."quotation_id" = q."id" AND it."query_id" = q."query_id" AND qi."sort_order" = 0 AND it."sort_order" = 0;--> statement-breakpoint
UPDATE "invoice_items" ii SET "quotation_item_id" = qi."id"
  FROM "invoices" i, "quotation_items" qi
  WHERE ii."invoice_id" = i."id" AND qi."quotation_id" = i."quotation_id" AND qi."sort_order" = ii."sort_order" AND qi."description" = ii."description";--> statement-breakpoint

-- 3. Currency and party details frozen on documents (old ones take today's currency setting).
ALTER TABLE "quotations" ADD COLUMN "currency" varchar(3) DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "customer_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "company_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "currency" varchar(3) DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "customer_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "company_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "packing_lists" ADD COLUMN "customer_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "packing_lists" ADD COLUMN "company_snapshot" jsonb;--> statement-breakpoint
UPDATE "quotations" SET "currency" = COALESCE((SELECT upper("value"->>'currency') FROM "settings" WHERE "key" = 'app'), 'USD');--> statement-breakpoint
UPDATE "invoices" SET "currency" = COALESCE((SELECT upper("value"->>'currency') FROM "settings" WHERE "key" = 'app'), 'USD');--> statement-breakpoint

-- 4. Invoices and packing lists always agree with their quotation, inquiry and customer.
UPDATE "invoices" i SET "query_id" = q."query_id" FROM "quotations" q WHERE i."quotation_id" = q."id" AND i."query_id" <> q."query_id";--> statement-breakpoint
UPDATE "invoices" i SET "customer_id" = q."customer_id" FROM "queries" q WHERE i."query_id" = q."id" AND i."customer_id" <> q."customer_id";--> statement-breakpoint
UPDATE "packing_lists" p SET "query_id" = i."query_id", "customer_id" = i."customer_id" FROM "invoices" i
  WHERE p."invoice_id" = i."id" AND (p."query_id" <> i."query_id" OR p."customer_id" <> i."customer_id");--> statement-breakpoint
ALTER TABLE "queries" ADD CONSTRAINT "queries_id_customer_uq" UNIQUE("id","customer_id");--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_id_query_uq" UNIQUE("id","query_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_id_query_customer_uq" UNIQUE("id","query_id","customer_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_quotation_query_fk" FOREIGN KEY ("quotation_id","query_id") REFERENCES "public"."quotations"("id","query_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_query_customer_fk" FOREIGN KEY ("query_id","customer_id") REFERENCES "public"."queries"("id","customer_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "packing_lists" ADD CONSTRAINT "packing_lists_invoice_party_fk" FOREIGN KEY ("invoice_id","query_id","customer_id") REFERENCES "public"."invoices"("id","query_id","customer_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint

-- 5. One packing list per invoice: extra ones (if any) are archived, not deleted.
UPDATE "packing_lists" p SET "deleted_at" = now()
  WHERE p."deleted_at" IS NULL AND EXISTS (
    SELECT 1 FROM "packing_lists" o
    WHERE o."invoice_id" = p."invoice_id" AND o."deleted_at" IS NULL AND (o."created_at", o."id") < (p."created_at", p."id"));--> statement-breakpoint
DROP INDEX "packing_lists_invoice_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "packing_lists_invoice_uq" ON "packing_lists" USING btree ("invoice_id") WHERE "packing_lists"."deleted_at" is null;--> statement-breakpoint
UPDATE "packing_list_items" pi SET "invoice_item_id" = ii."id"
  FROM "packing_lists" p, "invoice_items" ii
  WHERE pi."packing_list_id" = p."id" AND ii."invoice_id" = p."invoice_id" AND ii."sort_order" = pi."sort_order" AND ii."description" = pi."description";
