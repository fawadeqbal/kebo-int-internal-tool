-- Customer money the ERPNext way (claude/treasury-2c-design.md). One payment entry per transfer (money_movements:
-- what arrived or left, as on the bank statement) and what it pays underneath (allocations: an order, an advance
-- paid back, an advance kept as a fee). What a movement's live allocations do not take is the customer's credit
-- (their advance): worked out (movement_unallocated), never stored as rows.
--
-- Replaces customer_receipts (one transfer over several orders), payments (one order's part, and "paid from
-- credit") and customer_credits (left over, kept from a cancelled order, used, refunded, kept as a fee).
-- payments keep their ids as allocations (links to /payments/customer/<id> keep working); a transfer keeps its id
-- as a movement, and a payment that was its own transfer gives its id to its movement too.
-- customer_credits stays as credits_before_movements until the ledger check passes on live. The ledger is posted
-- again from the new records (its rows are cleared here; the deploy and the API's start post it).

-- ---------------------------------------------------------------- tables

CREATE TABLE "money_movements" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "direction" VARCHAR(10) NOT NULL,
    "party_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "alloc_currency" CHAR(3) NOT NULL,
    "rate" DECIMAL(24,14) NOT NULL DEFAULT 1,
    "allocatable" DECIMAL(14,2) NOT NULL,
    "account_id" UUID,
    "value_date" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'bank_transfer',
    "reference" VARCHAR(120),
    "paid_by_name" VARCHAR(120),
    "note" TEXT,
    "file_key" TEXT,
    "file_name" VARCHAR(255),
    "file_type" VARCHAR(150),
    "file_size" INTEGER,
    "recorded_by" UUID NOT NULL,
    "voided_at" TIMESTAMPTZ,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "money_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "money_movements_direction_check" CHECK ("direction" IN ('in', 'out')),
    CONSTRAINT "money_movements_amount_check" CHECK ("amount" > 0 AND "rate" > 0 AND "allocatable" >= 0)
);

CREATE TABLE "allocations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "movement_id" UUID NOT NULL,
    "target" VARCHAR(10) NOT NULL,
    "order_id" UUID,
    "refund_id" UUID,
    "kind" "PaymentKind" NOT NULL DEFAULT 'balance',
    "amount" DECIMAL(14,2) NOT NULL,
    "bank_charges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "share" DECIMAL(14,2) NOT NULL,
    "on" DATE NOT NULL,
    "later" BOOLEAN NOT NULL DEFAULT false,
    "receipt_no" INTEGER,
    "note" VARCHAR(300),
    "recorded_by" UUID NOT NULL,
    "voided_at" TIMESTAMPTZ,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "allocations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "allocations_target_check" CHECK (
      ("target" = 'order' AND "order_id" IS NOT NULL AND "refund_id" IS NULL)
      OR ("target" = 'refund' AND "refund_id" IS NOT NULL)
      OR ("target" = 'fee' AND "refund_id" IS NULL)),
    CONSTRAINT "allocations_amount_check" CHECK ("amount" > 0 AND "bank_charges" >= 0 AND "share" >= 0),
    -- Only an order's part is made with the movement; paying back and keeping as a fee come later, from credit.
    CONSTRAINT "allocations_later_check" CHECK ("target" = 'order' OR "later"),
    CONSTRAINT "allocations_receipt_no_check" CHECK ("receipt_no" IS NULL OR "receipt_no" >= 1)
);

CREATE INDEX "money_movements_party_id_idx" ON "money_movements"("party_id");
CREATE INDEX "money_movements_account_id_idx" ON "money_movements"("account_id");
CREATE INDEX "money_movements_value_date_idx" ON "money_movements"("value_date");
CREATE INDEX "money_movements_company_id_idx" ON "money_movements"("company_id");
CREATE INDEX "allocations_movement_id_idx" ON "allocations"("movement_id");
CREATE INDEX "allocations_order_id_idx" ON "allocations"("order_id");
CREATE INDEX "allocations_refund_id_idx" ON "allocations"("refund_id");
CREATE INDEX "allocations_on_idx" ON "allocations"("on");
CREATE INDEX "allocations_company_id_idx" ON "allocations"("company_id");
CREATE UNIQUE INDEX "allocations_order_id_receipt_no_key" ON "allocations"("order_id", "receipt_no");

ALTER TABLE "money_movements" ADD CONSTRAINT "money_movements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "money_movements" ADD CONSTRAINT "money_movements_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "money_movements" ADD CONSTRAINT "money_movements_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "money_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "money_movements" ADD CONSTRAINT "money_movements_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_movement_id_fkey" FOREIGN KEY ("movement_id") REFERENCES "money_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "money_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------- the data

-- 1. A transfer over several orders (and credit): a movement; what it counts as is its parts and its credit.
INSERT INTO "money_movements" (id, company_id, direction, party_id, amount, currency, alloc_currency, rate, allocatable,
                               account_id, value_date, method, reference, paid_by_name, note, file_key, file_name, file_type, file_size,
                               recorded_by, voided_at, void_reason, created_at, updated_at)
SELECT r.id, r.company_id, 'in', r.customer_id, r.received_amount, r.received_currency, r.currency, r.rate,
       coalesce((SELECT sum(p.amount) FROM payments p WHERE p.receipt_id = r.id), 0)
         + coalesce((SELECT sum(c.amount) FROM customer_credits c WHERE c.receipt_id = r.id AND c.kind = 'in'), 0),
       r.account_id, r.paid_on, r.method, r.reference, r.paid_by_name, r.note,
       f.file_key, f.file_name, f.file_type, f.file_size,
       r.recorded_by, r.voided_at, r.void_reason, r.created_at, r.created_at
  FROM customer_receipts r
  LEFT JOIN LATERAL (SELECT p.file_key, p.file_name, p.file_type, p.file_size FROM payments p
                      WHERE p.receipt_id = r.id AND p.file_key IS NOT NULL ORDER BY p.created_at LIMIT 1) f ON true;

-- 2. A payment that was its own transfer: a movement with its id.
INSERT INTO "money_movements" (id, company_id, direction, party_id, amount, currency, alloc_currency, rate, allocatable,
                               account_id, value_date, method, reference, paid_by_name, note, file_key, file_name, file_type, file_size,
                               recorded_by, voided_at, void_reason, created_at, updated_at)
SELECT p.id, p.company_id, 'in', o.customer_id, p.received_amount, p.received_currency, p.currency, p.rate, p.amount,
       p.account_id, p.paid_on, p.method, p.reference, p.paid_by_name, p.note, p.file_key, p.file_name, p.file_type, p.file_size,
       p.recorded_by, p.voided_at, p.void_reason, p.created_at, p.created_at
  FROM payments p JOIN orders o ON o.id = p.order_id
 WHERE p.receipt_id IS NULL AND p.method <> 'credit';

-- 3. Every payment from a transfer: what it pays (same id).
INSERT INTO "allocations" (id, company_id, movement_id, target, order_id, kind, amount, bank_charges, share, "on", later,
                           receipt_no, recorded_by, voided_at, void_reason, created_at)
SELECT p.id, p.company_id, coalesce(p.receipt_id, p.id), 'order', p.order_id, p.kind, p.amount, p.bank_charges, p.received_amount,
       p.paid_on, false, p.receipt_no, p.recorded_by, p.voided_at, p.void_reason, p.created_at
  FROM payments p
 WHERE p.method <> 'credit';

-- 4. A cancelled order's money kept as credit or as a fee: its parts released (the money is unallocated again).
UPDATE "allocations" a
   SET voided_at = c.created_at, void_reason = coalesce(c.note, 'Order cancelled')
  FROM customer_credits c
 WHERE c.kind IN ('in', 'fee') AND c.receipt_id IS NULL AND c.order_id = a.order_id AND c.voided_at IS NULL
   AND a.voided_at IS NULL;

-- 5. What came from credit later (paid an order, paid back, kept as a fee): allocations on the customer's oldest
-- money with something unallocated, in that currency (FIFO; a cancelled order's refund or fee first from its own
-- money); a refund is also the money out.
INSERT INTO "money_movements" (id, company_id, direction, party_id, amount, currency, alloc_currency, rate, allocatable,
                               account_id, value_date, method, note, recorded_by, voided_at, void_reason, created_at, updated_at)
SELECT c.id, c.company_id, 'out', c.customer_id, c.amount, c.currency, c.currency, 1, c.amount,
       c.account_id, c."on", 'bank_transfer', c.note, c.recorded_by, c.voided_at, c.void_reason, c.created_at, c.created_at
  FROM customer_credits c WHERE c.kind = 'refund';

DO $$
DECLARE
  item record;
  m record;
  left_amount numeric;
  take numeric;
  first boolean;
BEGIN
  FOR item IN
    SELECT p.id, p.company_id, o.customer_id AS party_id, p.currency, p.amount, 'order' AS target, p.order_id, NULL::uuid AS refund_id,
           p.kind, p.paid_on AS "on", p.receipt_no, p.note, NULL::uuid AS from_order, p.recorded_by, p.voided_at, p.void_reason, p.created_at
      FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.method = 'credit'
    UNION ALL
    SELECT c.id, c.company_id, c.customer_id, c.currency, c.amount, c.kind, c.order_id, CASE WHEN c.kind = 'refund' THEN c.id END,
           'balance', c."on", NULL, c.note, c.order_id, c.recorded_by, c.voided_at, c.void_reason, c.created_at
      FROM customer_credits c WHERE c.kind IN ('refund', 'fee')
     ORDER BY voided_at NULLS FIRST, "on", created_at
  LOOP
    left_amount := item.amount;
    first := true;
    FOR m IN
      SELECT mv.id, mv.allocatable - coalesce((SELECT sum(a.amount) FROM allocations a WHERE a.movement_id = mv.id AND a.voided_at IS NULL), 0) AS open
        FROM money_movements mv
       WHERE mv.party_id = item.party_id AND mv.direction = 'in' AND mv.alloc_currency = item.currency AND mv.voided_at IS NULL
       ORDER BY EXISTS (SELECT 1 FROM allocations x WHERE x.movement_id = mv.id AND x.order_id = item.from_order) DESC,
                mv.value_date, mv.created_at, mv.id
    LOOP
      EXIT WHEN left_amount <= 0;
      -- What was removed takes nothing: it sits on the oldest money, removed.
      take := CASE WHEN item.voided_at IS NOT NULL THEN left_amount ELSE least(left_amount, m.open) END;
      CONTINUE WHEN take <= 0;
      INSERT INTO allocations (id, company_id, movement_id, target, order_id, refund_id, kind, amount, share, "on", later,
                               receipt_no, note, recorded_by, voided_at, void_reason, created_at)
      VALUES (CASE WHEN first THEN item.id ELSE gen_random_uuid() END, item.company_id, m.id, item.target, item.order_id, item.refund_id,
              item.kind, take, take, item."on", true, CASE WHEN first THEN item.receipt_no END,
              CASE WHEN item.target = 'fee' THEN item.note END, item.recorded_by, item.voided_at, item.void_reason, item.created_at);
      left_amount := left_amount - take;
      first := false;
    END LOOP;
    IF left_amount > 0 THEN
      RAISE NOTICE 'credit not found for % % of % (party %): % left out', item.target, item.currency, item.amount, item.party_id, left_amount;
    END IF;
  END LOOP;
END $$;

-- 6. "Money reached us" ticked by a payment: by its allocation (same id).
ALTER TABLE "order_bank_steps" ADD COLUMN "allocation_id" UUID;
UPDATE "order_bank_steps" s SET allocation_id = s.payment_id WHERE EXISTS (SELECT 1 FROM allocations a WHERE a.id = s.payment_id);
ALTER TABLE "order_bank_steps" DROP CONSTRAINT "order_bank_steps_payment_id_fkey";
DROP TRIGGER IF EXISTS "same_company_order_bank_steps_payment_id_fkey" ON "order_bank_steps";
ALTER TABLE "order_bank_steps" DROP COLUMN "payment_id";
ALTER TABLE "order_bank_steps" ADD CONSTRAINT "order_bank_steps_allocation_id_fkey" FOREIGN KEY ("allocation_id") REFERENCES "allocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TRIGGER "same_company_order_bank_steps_allocation_id_fkey" BEFORE INSERT OR UPDATE OF "allocation_id" ON "order_bank_steps"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('allocations', 'allocation_id');

-- 7. The old tables: customer_credits kept (no links) until the ledger check passes on live; the rest go.
DROP TRIGGER IF EXISTS "orders_currency_keeps_payments" ON "orders";
DROP FUNCTION IF EXISTS order_currency_keeps_payments();
ALTER TABLE "customer_credits" DROP CONSTRAINT "customer_credits_payment_id_fkey";
ALTER TABLE "customer_credits" DROP CONSTRAINT "customer_credits_receipt_id_fkey";
DROP TRIGGER IF EXISTS "same_company_customer_credits_payment_id_fkey" ON "customer_credits";
DROP TRIGGER IF EXISTS "same_company_customer_credits_receipt_id_fkey" ON "customer_credits";
ALTER TABLE "customer_credits" RENAME TO "credits_before_movements";
DROP TABLE "payments";
DROP TABLE "customer_receipts";
DROP FUNCTION IF EXISTS payment_in_order_currency();

-- ---------------------------------------------------------------- rules

-- An order is paid in its own currency: the movement's allocation currency.
CREATE FUNCTION allocation_in_order_currency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c text; m text;
BEGIN
  IF NEW."order_id" IS NULL THEN RETURN NEW; END IF;
  SELECT o."currency" INTO c FROM "orders" o WHERE o."id" = NEW."order_id";
  SELECT mv."alloc_currency" INTO m FROM "money_movements" mv WHERE mv."id" = NEW."movement_id";
  IF c IS NOT NULL AND m <> c THEN
    RAISE EXCEPTION 'a payment is in its order''s currency (%), not %', c, m USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "allocations_in_order_currency" BEFORE INSERT OR UPDATE OF "order_id", "movement_id" ON "allocations"
  FOR EACH ROW EXECUTE FUNCTION allocation_in_order_currency();

-- …and the entry's allocation currency stays while it pays an order.
CREATE FUNCTION movement_keeps_order_currency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c text;
BEGIN
  SELECT o."currency" INTO c FROM "allocations" a JOIN "orders" o ON o."id" = a."order_id"
   WHERE a."movement_id" = NEW."id" AND o."currency" <> NEW."alloc_currency" LIMIT 1;
  IF c IS NOT NULL THEN
    RAISE EXCEPTION 'a payment is in its order''s currency (%), not %', c, NEW."alloc_currency" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "money_movements_keep_order_currency" BEFORE UPDATE OF "alloc_currency" ON "money_movements"
  FOR EACH ROW WHEN (NEW."alloc_currency" IS DISTINCT FROM OLD."alloc_currency") EXECUTE FUNCTION movement_keeps_order_currency();

CREATE FUNCTION order_currency_keeps_payments() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "allocations" a JOIN "money_movements" m ON m."id" = a."movement_id"
              WHERE a."order_id" = NEW."id" AND a."voided_at" IS NULL AND m."alloc_currency" <> NEW."currency") THEN
    RAISE EXCEPTION 'order % has payments in %: its currency stays', NEW."ref_no", OLD."currency" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "orders_currency_keeps_payments" BEFORE UPDATE OF "currency" ON "orders"
  FOR EACH ROW WHEN (NEW."currency" IS DISTINCT FROM OLD."currency") EXECUTE FUNCTION order_currency_keeps_payments();

-- Its receipt's number on the order (what pays an order only; a fee or refund from a cancelled order has none).
CREATE OR REPLACE FUNCTION number_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.target <> 'order' THEN RETURN NEW; END IF;
  IF NEW.receipt_no IS NULL THEN
    UPDATE orders SET last_receipt_no = last_receipt_no + 1 WHERE id = NEW.order_id RETURNING last_receipt_no INTO NEW.receipt_no;
  ELSE
    UPDATE orders SET last_receipt_no = greatest(last_receipt_no, NEW.receipt_no) WHERE id = NEW.order_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "allocations_receipt_no" BEFORE INSERT ON "allocations" FOR EACH ROW EXECUTE FUNCTION number_receipt();

-- Insights: an order's figures are worked out again when what pays it changes.
CREATE OR REPLACE FUNCTION facts_mark_row(p_table text, r jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  c uuid := (r ->> 'company_id')::uuid;
BEGIN
  CASE p_table
    WHEN 'orders' THEN
      PERFORM facts_enqueue(c, 'order', (r ->> 'id')::uuid);
    WHEN 'order_lines', 'order_costs', 'allocations', 'payment_plan_items', 'factory_payments', 'factory_payment_plans',
         'shipments', 'order_factories', 'order_claims', 'order_bank_steps', 'expenses' THEN
      IF r ->> 'order_id' IS NOT NULL THEN PERFORM facts_enqueue(c, 'order', (r ->> 'order_id')::uuid); END IF;
    WHEN 'inquiries' THEN
      PERFORM facts_enqueue(c, 'inquiry', (r ->> 'id')::uuid);
    WHEN 'factory_quotes', 'quotations' THEN
      PERFORM facts_enqueue(c, 'inquiry', (r ->> 'inquiry_id')::uuid);
    WHEN 'quotation_revisions' THEN
      PERFORM facts_enqueue(c, 'inquiry', (SELECT q."inquiry_id" FROM "quotations" q WHERE q."id" = (r ->> 'quotation_id')::uuid));
    WHEN 'quotation_options' THEN
      PERFORM facts_enqueue(c, 'inquiry', (SELECT q."inquiry_id" FROM "quotation_revisions" v JOIN "quotations" q ON q."id" = v."quotation_id"
                                             WHERE v."id" = (r ->> 'revision_id')::uuid));
    ELSE
      NULL;
  END CASE;
END $$;
CREATE TRIGGER "facts_mark" AFTER INSERT OR DELETE OR UPDATE ON "allocations" FOR EACH ROW EXECUTE FUNCTION facts_mark();

-- Same company on every link; row-level security; the app's rights.
CREATE TRIGGER "same_company_money_movements_party_id_fkey" BEFORE INSERT OR UPDATE OF "party_id" ON "money_movements"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('parties', 'party_id');
CREATE TRIGGER "same_company_money_movements_account_id_fkey" BEFORE INSERT OR UPDATE OF "account_id" ON "money_movements"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('money_accounts', 'account_id');
CREATE TRIGGER "same_company_money_movements_recorded_by_fkey" BEFORE INSERT OR UPDATE OF "recorded_by" ON "money_movements"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('users', 'recorded_by');
CREATE TRIGGER "same_company_allocations_movement_id_fkey" BEFORE INSERT OR UPDATE OF "movement_id" ON "allocations"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('money_movements', 'movement_id');
CREATE TRIGGER "same_company_allocations_order_id_fkey" BEFORE INSERT OR UPDATE OF "order_id" ON "allocations"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('orders', 'order_id');
CREATE TRIGGER "same_company_allocations_refund_id_fkey" BEFORE INSERT OR UPDATE OF "refund_id" ON "allocations"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('money_movements', 'refund_id');
CREATE TRIGGER "same_company_allocations_recorded_by_fkey" BEFORE INSERT OR UPDATE OF "recorded_by" ON "allocations"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('users', 'recorded_by');

ALTER TABLE "money_movements" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "money_movements" USING (company_id = (SELECT app_company())) WITH CHECK (company_id = (SELECT app_company()));
ALTER TABLE "allocations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "allocations" USING (company_id = (SELECT app_company())) WITH CHECK (company_id = (SELECT app_company()));
GRANT SELECT, INSERT, UPDATE, DELETE ON "money_movements", "allocations" TO kebo_app;

-- What each movement in still has unallocated: together, the customer's credit (per party and currency).
CREATE VIEW "movement_unallocated" WITH (security_invoker = true) AS
SELECT m.id, m.company_id, m.party_id, m.alloc_currency AS currency, m.value_date, m.created_at,
       m.allocatable - coalesce((SELECT sum(a.amount) FROM allocations a WHERE a.movement_id = m.id AND a.voided_at IS NULL), 0) AS unallocated
  FROM money_movements m
 WHERE m.direction = 'in' AND m.voided_at IS NULL;
GRANT SELECT ON "movement_unallocated" TO kebo_app;

-- ---------------------------------------------------------------- the ledger, posted again from these records

DELETE FROM "ledger_entries";
DELETE FROM "counters" WHERE key LIKE 'ledger-%';
DELETE FROM "ledger_state";
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_source_type_check";
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_source_type_check" CHECK ("source_type" IN
  ('order', 'purchase_order', 'movement', 'allocation', 'factory_payment', 'expense', 'transfer', 'account', 'fx_order', 'fx_factory'));
