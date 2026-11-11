-- Supplier payments and moves between our accounts as payment entries (claude/treasury-2d-design.md): ERPNext's
-- three payment types in one table. Receive (in, a customer), Pay (out, a customer's refund or a supplier) and
-- Internal Transfer (move). A supplier payment pays its order's purchase through one allocation (target purchase).
-- factory_payments and money_transfers keep their ids as movements (and a supplier payment its id as its
-- allocation too); both tables go. Their ledger rows are cleared: the deploy posts them again as movements.

-- ---------------------------------------------------------------- columns

ALTER TABLE "money_movements" ADD COLUMN "party_role" "PartyRoleKind";
ALTER TABLE "money_movements" ADD COLUMN "to_account_id" UUID;
ALTER TABLE "money_movements" ADD COLUMN "paid_by" UUID;
UPDATE "money_movements" SET party_role = 'customer';
ALTER TABLE "money_movements" ALTER COLUMN "party_id" DROP NOT NULL;
ALTER TABLE "money_movements" DROP CONSTRAINT "money_movements_direction_check";
ALTER TABLE "money_movements" ADD CONSTRAINT "money_movements_direction_check" CHECK (
  ("direction" IN ('in', 'out') AND "party_id" IS NOT NULL AND "party_role" IS NOT NULL AND "to_account_id" IS NULL)
  OR ("direction" = 'move' AND "party_id" IS NULL AND "party_role" IS NULL AND "account_id" IS NOT NULL
      AND "to_account_id" IS NOT NULL AND "account_id" <> "to_account_id"));
CREATE INDEX "money_movements_to_account_id_idx" ON "money_movements"("to_account_id");
ALTER TABLE "money_movements" ADD CONSTRAINT "money_movements_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "money_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "money_movements" ADD CONSTRAINT "money_movements_paid_by_fkey" FOREIGN KEY ("paid_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TRIGGER "same_company_money_movements_to_account_id_fkey" BEFORE INSERT OR UPDATE OF "to_account_id" ON "money_movements"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('money_accounts', 'to_account_id');
CREATE TRIGGER "same_company_money_movements_paid_by_fkey" BEFORE INSERT OR UPDATE OF "paid_by" ON "money_movements"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('users', 'paid_by');

-- What a supplier payment pays: what we owe the supplier on an order (made with the payment), linked by its own
-- column so an order reads what pays it (order_id) and what it paid its suppliers (purchase_order_id) apart.
ALTER TABLE "allocations" ADD COLUMN "purchase_order_id" UUID;
CREATE INDEX "allocations_purchase_order_id_idx" ON "allocations"("purchase_order_id");
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER "same_company_allocations_purchase_order_id_fkey" BEFORE INSERT OR UPDATE OF "purchase_order_id" ON "allocations"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_company('orders', 'purchase_order_id');
ALTER TABLE "allocations" DROP CONSTRAINT "allocations_target_check";
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_target_check" CHECK (
  ("target" = 'order' AND "order_id" IS NOT NULL AND "refund_id" IS NULL AND "purchase_order_id" IS NULL)
  OR ("target" = 'purchase' AND "purchase_order_id" IS NOT NULL AND "order_id" IS NULL AND "refund_id" IS NULL)
  OR ("target" = 'refund' AND "refund_id" IS NOT NULL AND "purchase_order_id" IS NULL)
  OR ("target" = 'fee' AND "refund_id" IS NULL AND "purchase_order_id" IS NULL));
ALTER TABLE "allocations" DROP CONSTRAINT "allocations_later_check";
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_later_check" CHECK ("target" IN ('order', 'purchase') OR "later");

-- ---------------------------------------------------------------- the data

INSERT INTO "money_movements" (id, company_id, direction, party_role, party_id, amount, currency, alloc_currency, rate, allocatable,
                               account_id, paid_by, value_date, method, reference, note, file_key, file_name, file_type, file_size,
                               recorded_by, voided_at, void_reason, created_at, updated_at)
SELECT p.id, p.company_id, 'out', 'supplier', p.factory_id, p.amount, p.currency, o.currency, p.rate, round(p.amount / p.rate, 2),
       p.account_id, p.paid_by, p.paid_on, p.method, p.reference, p.note, p.file_key, p.file_name, p.file_type, p.file_size,
       p.recorded_by, p.voided_at, p.void_reason, p.created_at, p.updated_at
  FROM factory_payments p JOIN orders o ON o.id = p.order_id;

INSERT INTO "allocations" (id, company_id, movement_id, target, purchase_order_id, kind, amount, share, "on", recorded_by, voided_at, void_reason, created_at)
SELECT p.id, p.company_id, p.id, 'purchase', p.order_id, p.kind, greatest(round(p.amount / p.rate, 2), 0.01), p.amount, p.paid_on,
       p.recorded_by, p.voided_at, p.void_reason, p.created_at
  FROM factory_payments p;

INSERT INTO "money_movements" (id, company_id, direction, amount, currency, alloc_currency, rate, allocatable,
                               account_id, to_account_id, value_date, reference, note, recorded_by, voided_at, void_reason, created_at, updated_at)
SELECT t.id, t.company_id, 'move', t.amount_out, f.currency, d.currency, round(t.amount_out / t.amount_in, 14), t.amount_in,
       t.from_account_id, t.to_account_id, t.transferred_on, t.reference, t.note, t.recorded_by, t.voided_at, t.void_reason, t.created_at, t.created_at
  FROM money_transfers t JOIN money_accounts f ON f.id = t.from_account_id JOIN money_accounts d ON d.id = t.to_account_id;

DROP TABLE "factory_payments";
DROP TABLE "money_transfers";

-- ---------------------------------------------------------------- rules

-- The customer's credit: their money in (a supplier never has any).
CREATE OR REPLACE VIEW "movement_unallocated" WITH (security_invoker = true) AS
SELECT m.id, m.company_id, m.party_id, m.alloc_currency AS currency, m.value_date, m.created_at,
       m.allocatable - coalesce((SELECT sum(a.amount) FROM allocations a WHERE a.movement_id = m.id AND a.voided_at IS NULL), 0) AS unallocated
  FROM money_movements m
 WHERE m.direction = 'in' AND m.party_role = 'customer' AND m.voided_at IS NULL;

CREATE OR REPLACE FUNCTION facts_mark_row(p_table text, r jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  c uuid := (r ->> 'company_id')::uuid;
BEGIN
  CASE p_table
    WHEN 'orders' THEN
      PERFORM facts_enqueue(c, 'order', (r ->> 'id')::uuid);
    WHEN 'order_lines', 'order_costs', 'allocations', 'payment_plan_items', 'factory_payment_plans',
         'shipments', 'order_factories', 'order_claims', 'order_bank_steps', 'expenses' THEN
      IF coalesce(r ->> 'order_id', r ->> 'purchase_order_id') IS NOT NULL THEN
        PERFORM facts_enqueue(c, 'order', coalesce(r ->> 'order_id', r ->> 'purchase_order_id')::uuid);
      END IF;
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

-- ---------------------------------------------------------------- the ledger, posted again for these records

-- Exchange differences and openings follow from what is posted before them: the whole ledger is posted again.
DELETE FROM "ledger_entries";
DELETE FROM "counters" WHERE key LIKE 'ledger-%';
DELETE FROM "ledger_state";
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_source_type_check";
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_source_type_check" CHECK ("source_type" IN
  ('order', 'purchase_order', 'movement', 'allocation', 'expense', 'account', 'fx_order', 'fx_factory'));
