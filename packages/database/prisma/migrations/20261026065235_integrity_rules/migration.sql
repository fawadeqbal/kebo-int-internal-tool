-- Rules the database itself guarantees (Prisma's schema language cannot express these).

-- A quotation has at most one draft and at most one accepted revision.
CREATE UNIQUE INDEX "quotation_revisions_one_draft" ON "quotation_revisions" ("quotation_id") WHERE "status" = 'draft' AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "quotation_revisions_one_accepted" ON "quotation_revisions" ("quotation_id") WHERE "status" = 'accepted';

-- Percentages and amounts stay in range.
ALTER TABLE "quotation_revisions"
  ADD CONSTRAINT "quotation_revisions_deposit_pct" CHECK ("deposit_percent" BETWEEN 0 AND 100),
  ADD CONSTRAINT "quotation_revisions_vat_rate" CHECK ("vat_rate" BETWEEN 0 AND 100),
  ADD CONSTRAINT "quotation_revisions_amounts" CHECK ("discount" >= 0 AND "subtotal" >= 0 AND "total" >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_deposit_pct" CHECK ("deposit_percent" BETWEEN 0 AND 100);
ALTER TABLE "factory_orders" ADD CONSTRAINT "factory_orders_deposit_pct" CHECK ("deposit_percent" BETWEEN 0 AND 100);

-- Quantities are positive on every kind of line.
ALTER TABLE "requested_items" ADD CONSTRAINT "requested_items_qty" CHECK ("quantity" > 0);
ALTER TABLE "factory_quote_lines" ADD CONSTRAINT "factory_quote_lines_qty" CHECK ("quantity" > 0 AND "unit_price" >= 0);
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_qty" CHECK ("quantity" > 0 AND "unit_price" >= 0);
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_qty" CHECK ("quantity" > 0);
ALTER TABLE "factory_order_lines" ADD CONSTRAINT "factory_order_lines_qty" CHECK ("quantity" > 0);
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_qty" CHECK ("quantity" > 0);
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_qty" CHECK ("quantity" > 0 AND "packages" >= 0);

-- Payments: positive, and money in names a customer while money out names a factory.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount" CHECK ("amount" > 0 AND "bank_charges" >= 0),
  ADD CONSTRAINT "payments_party" CHECK (
    ("direction" = 'in' AND "customer_id" IS NOT NULL AND "factory_id" IS NULL)
    OR ("direction" = 'out' AND "factory_id" IS NOT NULL AND "customer_id" IS NULL)
  );

-- An issued invoice has its number and dates; a lost deal has its reason.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_complete" CHECK ("status" = 'draft' OR ("number" IS NOT NULL AND "issue_date" IS NOT NULL));
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_lost_reason" CHECK ("stage" <> 'lost' OR "lost_reason" IS NOT NULL);

-- One primary contact per customer.
CREATE UNIQUE INDEX "contacts_one_primary" ON "contacts" ("customer_id") WHERE "is_primary" AND "deleted_at" IS NULL;
