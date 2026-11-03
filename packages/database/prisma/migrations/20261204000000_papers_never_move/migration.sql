-- Single source of truth, PR 2: papers that never move (3 Nov 2026).
-- 1. Receipt and payment-request numbers are stored: given once when the payment / plan row is made, never
--    changed or reused (voiding or back-dating a payment, rebuilding the plan moves no other paper's number).
--    The database gives them (a trigger counts per order), so every way of recording a payment or a plan
--    row gets one. Existing rows get the number they print today: payments not voided in date order
--    (paid on, then recorded), plan rows in their order. Voided payments are no longer printed: they get none.
-- 2. The buyer is frozen at the order (orders.buyer_snapshot), printed on every paper of the order;
--    existing orders get the buyer their papers print today: the quotation's customer, details missing
--    there from the customer now.
-- 3. orders.print_quoted_terms: the quotation's payment text is printed although the route now differs.
-- 4. Rows of the document set that the app makes itself (proforma, packing list, sales contract,
--    commercial invoice) are no longer recorded by hand: hand-made ones are removed, their files kept
--    (on the paper made by the app when there is one, and always among the order's files on its step).
-- The proforma's and the packing list's snapshots are taken by the API when it starts (they are made by
-- its code); see apps/api/src/modules/orders/order-docs.ts.
-- Plain columns on company tables: the tables' row-level security and grants already cover them.
-- Everything here is safe on an empty database.

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "buyer_snapshot" JSONB,
ADD COLUMN     "last_receipt_no" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_request_no" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "print_quoted_terms" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "payment_plan_items" ADD COLUMN     "request_no" INTEGER;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "receipt_no" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "payment_plan_items_order_id_request_no_key" ON "payment_plan_items"("order_id", "request_no");

-- CreateIndex
CREATE UNIQUE INDEX "payments_order_id_receipt_no_key" ON "payments"("order_id", "receipt_no");

ALTER TABLE "payments" ADD CONSTRAINT "payments_receipt_no_check" CHECK ("receipt_no" IS NULL OR "receipt_no" >= 1);
ALTER TABLE "payment_plan_items" ADD CONSTRAINT "payment_plan_items_request_no_check" CHECK ("request_no" IS NULL OR "request_no" >= 1);

-- 1. Numbers today's papers print.
UPDATE "payments" p
   SET "receipt_no" = x.n
  FROM (SELECT "id", row_number() OVER (PARTITION BY "order_id" ORDER BY "paid_on", "created_at", "id") AS n
          FROM "payments" WHERE "voided_at" IS NULL) x
 WHERE x."id" = p."id";
UPDATE "payment_plan_items" i
   SET "request_no" = x.n
  FROM (SELECT "id", row_number() OVER (PARTITION BY "order_id" ORDER BY "sort_order", "id") AS n
          FROM "payment_plan_items") x
 WHERE x."id" = i."id";
UPDATE "orders" o
   SET "last_receipt_no" = coalesce((SELECT max(p."receipt_no") FROM "payments" p WHERE p."order_id" = o."id"), 0),
       "last_request_no" = coalesce((SELECT max(i."request_no") FROM "payment_plan_items" i WHERE i."order_id" = o."id"), 0);

-- New rows: the next number of their order (a number given by hand moves the count past it).
CREATE OR REPLACE FUNCTION number_receipt() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.receipt_no IS NULL THEN
    UPDATE orders SET last_receipt_no = last_receipt_no + 1 WHERE id = NEW.order_id RETURNING last_receipt_no INTO NEW.receipt_no;
  ELSE
    UPDATE orders SET last_receipt_no = greatest(last_receipt_no, NEW.receipt_no) WHERE id = NEW.order_id;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION number_request() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.request_no IS NULL THEN
    UPDATE orders SET last_request_no = last_request_no + 1 WHERE id = NEW.order_id RETURNING last_request_no INTO NEW.request_no;
  ELSE
    UPDATE orders SET last_request_no = greatest(last_request_no, NEW.request_no) WHERE id = NEW.order_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "payments_receipt_no" BEFORE INSERT ON "payments" FOR EACH ROW EXECUTE FUNCTION number_receipt();
CREATE TRIGGER "payment_plan_items_request_no" BEFORE INSERT ON "payment_plan_items" FOR EACH ROW EXECUTE FUNCTION number_request();

-- 2. The buyer each order's papers print today: the quotation's customer (frozen when it was sent), with
--    the details missing there (null or empty) from the customer and the deal's contact (else the primary) now.
UPDATE "orders" o
   SET "buyer_snapshot" = jsonb_build_object(
         'name', c."name",
         'country', c."country",
         'address', c."address",
         'taxNo', c."tax_no",
         'regNo', c."reg_no",
         'contact', (SELECT jsonb_build_object('name', ct."name", 'email', ct."email", 'phone', coalesce(ct."phone", ct."whatsapp"))
                       FROM "contacts" ct
                      WHERE ct."customer_id" = c."id" AND ct."deleted_at" IS NULL
                      ORDER BY (ct."id" = i."contact_id") DESC NULLS LAST, ct."is_primary" DESC, ct."created_at", ct."id"
                      LIMIT 1))
       || coalesce((SELECT jsonb_object_agg(e.key, e.value)
                      FROM jsonb_each(CASE WHEN jsonb_typeof(r."customer_snapshot") = 'object' THEN r."customer_snapshot" ELSE '{}'::jsonb END) e
                     WHERE e.value NOT IN ('null'::jsonb, '""'::jsonb)), '{}'::jsonb)
       || jsonb_build_object('takenOn', to_char(current_date, 'YYYY-MM-DD'), 'from', 'data')
  FROM "customers" c, "inquiries" i, "quotation_revisions" r
 WHERE c."id" = o."customer_id" AND i."id" = o."inquiry_id" AND r."id" = o."revision_id" AND o."buyer_snapshot" IS NULL;

-- 4. Hand-made rows of the kinds the app makes: their file goes on the app's own paper of that kind (when it
--    has none yet) and among the order's files on its step; then the rows go.
UPDATE "order_documents" p
   SET "attachment_id" = h."attachment_id"
  FROM (SELECT DISTINCT ON ("order_id", "kind") "order_id", "kind", "attachment_id"
          FROM "order_documents"
         WHERE "paper_id" IS NULL AND "attachment_id" IS NOT NULL
           AND "kind" IN ('proforma_invoice', 'packing_list', 'sales_contract', 'commercial_invoice')
         ORDER BY "order_id", "kind", "updated_at" DESC) h
 WHERE p."order_id" = h."order_id" AND p."kind" = h."kind" AND p."paper_id" IS NOT NULL AND p."attachment_id" IS NULL;

UPDATE "attachments" a
   SET "order_id" = coalesce(a."order_id", d."order_id"),
       "step" = coalesce(a."step", CASE WHEN d."kind" IN ('proforma_invoice', 'sales_contract') THEN 'payment' ELSE 'shipping' END),
       "note" = coalesce(a."note", left(CASE d."kind"
                                          WHEN 'proforma_invoice' THEN 'Proforma invoice'
                                          WHEN 'packing_list' THEN 'Packing list'
                                          WHEN 'sales_contract' THEN 'Sales contract'
                                          ELSE 'Commercial invoice' END
                                        || coalesce(' ' || d."number", '') || ' (was recorded by hand)', 300))
  FROM "order_documents" d
 WHERE d."attachment_id" = a."id" AND d."paper_id" IS NULL
   AND d."kind" IN ('proforma_invoice', 'packing_list', 'sales_contract', 'commercial_invoice');

DELETE FROM "order_documents"
 WHERE "paper_id" IS NULL AND "kind" IN ('proforma_invoice', 'packing_list', 'sales_contract', 'commercial_invoice');
