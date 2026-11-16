-- Terms that travel (design "RFQ Desk — terms that travel, one thing in one place", step 1): the factory offer and
-- the quotation keep their terms in the same four groups (Delivery · Payment · Warranty · Conditions), as facts a
-- date can be worked out from, beside the words they print:
-- - a lead time is days from a moment (after the advance or deposit, after the order, after the drawings are
--   approved); `lead_time` keeps its words ("30 days after the advance"), and old rows keep only their words;
-- - the payment is parts (the plan's: a share and when it falls due); an old offer keeps its one advance %, an old
--   quotation its deposit % and balance terms (both are still written, worked out from the parts);
-- - the warranty is months from a moment (shipment, delivery, the site test); `warranty` keeps the words of what
--   it covers (an old row: its whole sentence).
-- The quotation also keeps how the customer pays (empty: not decided yet) and where the goods go. Nothing is
-- removed or rewritten: every old offer, quotation and paper reads as it did.

ALTER TABLE "factory_quotes"
  ADD COLUMN "lead_days" INTEGER,
  ADD COLUMN "lead_from" TEXT,
  ADD COLUMN "payment_parts" JSONB,
  ADD COLUMN "warranty_months" INTEGER,
  ADD COLUMN "warranty_from" TEXT;
ALTER TABLE "factory_quotes" ADD CONSTRAINT "factory_quotes_terms_check" CHECK (
  ("lead_days" IS NULL OR ("lead_days" >= 0 AND "lead_days" <= 3650))
  AND ("lead_from" IS NULL OR "lead_from" IN ('after_payment', 'after_order', 'after_drawings'))
  AND ("payment_parts" IS NULL OR jsonb_typeof("payment_parts") = 'array')
  AND ("warranty_months" IS NULL OR ("warranty_months" >= 0 AND "warranty_months" <= 240))
  AND ("warranty_from" IS NULL OR "warranty_from" IN ('shipment', 'delivery', 'sat'))
);

ALTER TABLE "quotation_revisions"
  ADD COLUMN "payment_route" "PaymentRoute",
  ADD COLUMN "payment_parts" JSONB,
  ADD COLUMN "port_of_discharge" VARCHAR(80),
  ADD COLUMN "warranty_months" INTEGER,
  ADD COLUMN "warranty_from" TEXT;
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_terms_check" CHECK (
  ("payment_parts" IS NULL OR jsonb_typeof("payment_parts") = 'array')
  AND ("warranty_months" IS NULL OR ("warranty_months" >= 0 AND "warranty_months" <= 240))
  AND ("warranty_from" IS NULL OR "warranty_from" IN ('shipment', 'delivery', 'sat'))
);

ALTER TABLE "quotation_options"
  ADD COLUMN "lead_days" INTEGER,
  ADD COLUMN "lead_from" TEXT;
ALTER TABLE "quotation_options" ADD CONSTRAINT "quotation_options_lead_check" CHECK (
  ("lead_days" IS NULL OR ("lead_days" >= 0 AND "lead_days" <= 3650))
  AND ("lead_from" IS NULL OR "lead_from" IN ('after_payment', 'after_order', 'after_drawings'))
);
