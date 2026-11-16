-- Design "RFQ Desk — terms that travel" (16 Nov 2026), step 3b: what was agreed with each factory, kept on its
-- purchase order when the order is sent to the factory (copied from the offer its lines were bought on), changed
-- there later with a reason. Until it is sent (and on purchase orders sent before this), the offer's terms show.
-- terms_copied says the purchase order has its own copy. Nothing else changes.
ALTER TABLE "purchase_orders"
  ADD COLUMN "terms_copied" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "basis" "Incoterm",
  ADD COLUMN "basis_place" VARCHAR(60),
  ADD COLUMN "lead_days" INTEGER,
  ADD COLUMN "lead_from" TEXT,
  ADD COLUMN "warranty_months" INTEGER,
  ADD COLUMN "warranty_from" TEXT,
  ADD COLUMN "warranty_words" VARCHAR(300),
  ADD COLUMN "payment_note" TEXT,
  ADD COLUMN "moq" VARCHAR(60),
  ADD COLUMN "conditions_notes" TEXT;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_agreed_terms_check" CHECK (
  ("lead_days" IS NULL OR ("lead_days" >= 0 AND "lead_days" <= 3650))
  AND ("lead_from" IS NULL OR "lead_from" IN ('after_payment', 'after_order', 'after_drawings'))
  AND ("warranty_months" IS NULL OR ("warranty_months" >= 0 AND "warranty_months" <= 240))
  AND ("warranty_from" IS NULL OR "warranty_from" IN ('shipment', 'delivery', 'sat'))
);
