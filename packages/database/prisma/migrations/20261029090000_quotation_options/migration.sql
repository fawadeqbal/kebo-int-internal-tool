-- Step 2b: a quotation revision offers one or more options (A, B…), each one
-- factory's offer; the customer accepts exactly one. Factory lines can have parts.
-- The per-item "quote from this price" choice is gone: an option is a whole offer.

-- CreateEnum
CREATE TYPE "OptionStatus" AS ENUM ('open', 'accepted', 'not_chosen');

-- Factory lines: parts of a line of the same offer.
ALTER TABLE "factory_quote_lines" ADD COLUMN "parent_id" UUID;
ALTER TABLE "factory_quote_lines" ADD CONSTRAINT "factory_quote_lines_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "factory_quote_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "factory_quote_lines" ADD CONSTRAINT "factory_quote_lines_parent_check" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");
CREATE INDEX "factory_quote_lines_parent_id_idx" ON "factory_quote_lines"("parent_id");

-- The old per-item choice.
ALTER TABLE "requested_items" DROP CONSTRAINT "requested_items_preferred_factory_line_id_fkey";
ALTER TABLE "requested_items" DROP COLUMN "preferred_factory_line_id";

-- CreateTable
CREATE TABLE "quotation_options" (
    "id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "letter" VARCHAR(2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "factory_quote_id" UUID,
    "status" "OptionStatus" NOT NULL DEFAULT 'open',
    "lead_time" VARCHAR(120),
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "quotation_options_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "quotation_options_factory_quote_id_idx" ON "quotation_options"("factory_quote_id");
CREATE UNIQUE INDEX "quotation_options_revision_id_letter_key" ON "quotation_options"("revision_id", "letter");
ALTER TABLE "quotation_options" ADD CONSTRAINT "quotation_options_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "quotation_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quotation_options" ADD CONSTRAINT "quotation_options_factory_quote_id_fkey" FOREIGN KEY ("factory_quote_id") REFERENCES "factory_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quotation_options" ADD CONSTRAINT "quotation_options_letter_check" CHECK ("letter" ~ '^[A-Z]$');

-- Every existing revision becomes Option A with its own totals and lead time;
-- its factory is the offer most of its lines were priced from (if any).
INSERT INTO "quotation_options" ("id", "revision_id", "letter", "sort_order", "factory_quote_id", "status", "lead_time", "subtotal", "discount", "total")
SELECT gen_random_uuid(), r."id", 'A', 0,
       (SELECT fl."factory_quote_id"
          FROM "quote_lines" ql JOIN "factory_quote_lines" fl ON fl."id" = ql."factory_quote_line_id"
         WHERE ql."revision_id" = r."id"
         GROUP BY fl."factory_quote_id" ORDER BY count(*) DESC LIMIT 1),
       CASE WHEN r."status" IN ('accepted', 'void') THEN 'accepted'::"OptionStatus" ELSE 'open'::"OptionStatus" END,
       r."lead_time", r."subtotal", r."discount", r."total"
  FROM "quotation_revisions" r;

ALTER TABLE "quote_lines" ADD COLUMN "option_id" UUID;
UPDATE "quote_lines" ql SET "option_id" = o."id" FROM "quotation_options" o WHERE o."revision_id" = ql."revision_id";
ALTER TABLE "quote_lines" ALTER COLUMN "option_id" SET NOT NULL;
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "quotation_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "quote_lines_option_id_idx" ON "quote_lines"("option_id");
