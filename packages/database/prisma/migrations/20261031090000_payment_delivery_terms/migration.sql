-- The quotation's one "Terms" text becomes two: payment terms and delivery terms.
-- What was written before stays, as the payment terms.
ALTER TABLE "quotation_revisions" RENAME COLUMN "terms" TO "payment_terms";
ALTER TABLE "quotation_revisions" ADD COLUMN "delivery_terms" TEXT;

-- The default text in Settings follows: defaultTerms → defaultPaymentTerms (and an empty defaultDeliveryTerms).
UPDATE "settings"
   SET "value" = ("value" - 'defaultTerms')
               || jsonb_build_object('defaultPaymentTerms', COALESCE("value"->'defaultTerms', '""'::jsonb), 'defaultDeliveryTerms', '""'::jsonb)
 WHERE "key" = 'sales' AND "value" ? 'defaultTerms';
