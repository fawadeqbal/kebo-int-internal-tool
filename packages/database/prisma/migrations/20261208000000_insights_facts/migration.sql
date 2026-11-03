-- Insights data: three calculated tables (owner, 3 Nov 2026; plan docs/superpowers/plans/2026-11-03-insights-b-facts.md).
-- order_facts (one row per order), inquiry_facts (one per inquiry) and factory_order_facts (one per order ×
-- factory) hold ready-made figures for Insights, written only by the API (FactsService) through the shared
-- money and shipping rules; people never type into them. facts_queue says what they still have to catch up
-- on: triggers on the tables the figures come from add the order or inquiry there, the API works it off
-- after each change and before each read, and the worker rebuilds everything every night (comparing, logging
-- and fixing any difference).
-- Nothing is copied here: the tables start empty (safe on an empty database) and the API / worker fill them
-- on start when they are empty and the company has orders or inquiries.

-- CreateTable
CREATE TABLE "order_facts" (
    "order_id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "inquiry_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "handled_by" UUID,
    "country" CHAR(2) NOT NULL,
    "channel" "InquiryChannel" NOT NULL,
    "category" VARCHAR(120) NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "stage" "order_stage" NOT NULL,
    "ordered_on" DATE NOT NULL,
    "ship_by" DATE,
    "ready_on" DATE,
    "shipped_on" DATE,
    "delivered_on" DATE,
    "closed_on" DATE,
    "currency" CHAR(3) NOT NULL,
    "main_currency" CHAR(3) NOT NULL,
    "rate_known" BOOLEAN NOT NULL,
    "total_main" DECIMAL(16,2) NOT NULL,
    "costed_main" DECIMAL(16,2) NOT NULL,
    "cost_main" DECIMAL(16,2) NOT NULL,
    "profit_quote_main" DECIMAL(16,2) NOT NULL,
    "profit_expected_main" DECIMAL(16,2) NOT NULL,
    "margin_quote" DECIMAL(8,1),
    "margin" DECIMAL(8,1),
    "expenses_main" DECIMAL(16,2) NOT NULL,
    "costs_over_plan_main" DECIMAL(16,2) NOT NULL,
    "received_main" DECIMAL(16,2) NOT NULL,
    "due_main" DECIMAL(16,2) NOT NULL,
    "overdue_main" DECIMAL(16,2) NOT NULL,
    "open_parts" JSONB NOT NULL DEFAULT '[]',
    "paid_in_full_on" DATE,
    "paid_on_time" BOOLEAN,
    "on_time" BOOLEAN,
    "days_quote_to_order" INTEGER,
    "days_to_ship" INTEGER,
    "computed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_facts_pkey" PRIMARY KEY ("order_id")
);

-- CreateTable
CREATE TABLE "inquiry_facts" (
    "inquiry_id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "customer_id" UUID NOT NULL,
    "handled_by" UUID,
    "channel" "InquiryChannel" NOT NULL,
    "country" CHAR(2) NOT NULL,
    "category" VARCHAR(120) NOT NULL,
    "stage" "InquiryStage" NOT NULL,
    "received_on" DATE NOT NULL,
    "first_quote_on" DATE,
    "got_prices" BOOLEAN NOT NULL,
    "quoted_value_main" DECIMAL(16,2),
    "main_currency" CHAR(3) NOT NULL,
    "outcome" VARCHAR(4) NOT NULL,
    "lost_reason" "LostReason",
    "closed_on" DATE,
    "days_to_first_quote" INTEGER,
    "days_to_close" INTEGER,
    "computed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inquiry_facts_pkey" PRIMARY KEY ("inquiry_id")
);

-- CreateTable
CREATE TABLE "factory_order_facts" (
    "order_id" UUID NOT NULL,
    "factory_id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "status" "OrderStatus" NOT NULL,
    "ordered_on" DATE NOT NULL,
    "currency" CHAR(3),
    "owed" DECIMAL(16,2),
    "paid" DECIMAL(16,2),
    "to_pay" DECIMAL(16,2),
    "main_currency" CHAR(3) NOT NULL,
    "owed_main" DECIMAL(16,2) NOT NULL,
    "paid_main" DECIMAL(16,2) NOT NULL,
    "to_pay_main" DECIMAL(16,2) NOT NULL,
    "open_parts" JSONB NOT NULL DEFAULT '[]',
    "ready_promised" DATE,
    "ready_actual" DATE,
    "days_late" INTEGER,
    "on_time" BOOLEAN,
    "offers_sent" INTEGER NOT NULL,
    "offer_won" BOOLEAN NOT NULL,
    "claims" INTEGER NOT NULL,
    "computed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "factory_order_facts_pkey" PRIMARY KEY ("order_id","factory_id")
);

-- CreateTable
CREATE TABLE "facts_queue" (
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "kind" VARCHAR(10) NOT NULL,
    "entity_id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "queued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facts_queue_pkey" PRIMARY KEY ("company_id","kind","entity_id")
);

-- CreateIndex
CREATE INDEX "order_facts_company_id_ordered_on_idx" ON "order_facts"("company_id", "ordered_on");

-- CreateIndex
CREATE INDEX "order_facts_customer_id_idx" ON "order_facts"("customer_id");

-- CreateIndex
CREATE INDEX "order_facts_inquiry_id_idx" ON "order_facts"("inquiry_id");

-- CreateIndex
CREATE INDEX "order_facts_handled_by_idx" ON "order_facts"("handled_by");

-- CreateIndex
CREATE INDEX "inquiry_facts_company_id_received_on_idx" ON "inquiry_facts"("company_id", "received_on");

-- CreateIndex
CREATE INDEX "inquiry_facts_company_id_closed_on_idx" ON "inquiry_facts"("company_id", "closed_on");

-- CreateIndex
CREATE INDEX "inquiry_facts_customer_id_idx" ON "inquiry_facts"("customer_id");

-- CreateIndex
CREATE INDEX "inquiry_facts_handled_by_idx" ON "inquiry_facts"("handled_by");

-- CreateIndex
CREATE INDEX "factory_order_facts_company_id_ordered_on_idx" ON "factory_order_facts"("company_id", "ordered_on");

-- CreateIndex
CREATE INDEX "factory_order_facts_factory_id_idx" ON "factory_order_facts"("factory_id");

-- AddForeignKey
ALTER TABLE "order_facts" ADD CONSTRAINT "order_facts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_facts" ADD CONSTRAINT "order_facts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_facts" ADD CONSTRAINT "order_facts_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_facts" ADD CONSTRAINT "order_facts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_facts" ADD CONSTRAINT "order_facts_handled_by_fkey" FOREIGN KEY ("handled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_facts" ADD CONSTRAINT "inquiry_facts_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_facts" ADD CONSTRAINT "inquiry_facts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_facts" ADD CONSTRAINT "inquiry_facts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_facts" ADD CONSTRAINT "inquiry_facts_handled_by_fkey" FOREIGN KEY ("handled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_order_facts" ADD CONSTRAINT "factory_order_facts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_order_facts" ADD CONSTRAINT "factory_order_facts_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_order_facts" ADD CONSTRAINT "factory_order_facts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facts_queue" ADD CONSTRAINT "facts_queue_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sensible values only.
ALTER TABLE "inquiry_facts" ADD CONSTRAINT "inquiry_facts_outcome_check" CHECK ("outcome" IN ('open', 'won', 'lost'));
ALTER TABLE "facts_queue" ADD CONSTRAINT "facts_queue_kind_check" CHECK ("kind" IN ('order', 'inquiry', 'all'));

-- Kept apart per company like every company table (see the companies and company_role migrations).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['order_facts', 'inquiry_facts', 'factory_order_facts', 'facts_queue'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY company_isolation ON %I USING (company_id = (SELECT app_company())) WITH CHECK (company_id = (SELECT app_company()))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO kebo_app', t);
  END LOOP;
END $$;
GRANT USAGE, SELECT ON SEQUENCE "facts_queue_seq_seq" TO kebo_app;

-- Every new link between company tables may only point inside the company.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT cl.relname AS child, pa.relname AS parent, a.attname AS col, k.conname
      FROM pg_constraint k
      JOIN pg_class cl ON cl.oid = k.conrelid
      JOIN pg_class pa ON pa.oid = k.confrelid
      JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
      JOIN pg_attribute pk ON pk.attrelid = k.confrelid AND pk.attnum = k.confkey[1]
     WHERE k.contype = 'f' AND cl.relrowsecurity AND pa.relrowsecurity
       AND array_length(k.conkey, 1) = 1 AND pk.attname = 'id' AND a.attname <> 'company_id'
       AND cl.relnamespace = current_schema()::regnamespace
       AND NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = k.conrelid AND tg.tgname = left('same_company_' || k.conname, 63))
     ORDER BY 1, 3
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I ON %I FOR EACH ROW EXECUTE FUNCTION enforce_same_company(%L, %L)',
                   left('same_company_' || r.conname, 63), r.col, r.child, r.parent, r.col);
  END LOOP;
END $$;

-- What to catch up on. One order or inquiry (or "all": the whole company) per row; queued again, it gets a new
-- seq, so a change made while the API was working the row off is not lost.
CREATE FUNCTION facts_enqueue(p_company uuid, p_kind text, p_id uuid) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO "facts_queue" ("company_id", "kind", "entity_id")
  SELECT p_company, p_kind, p_id WHERE p_company IS NOT NULL AND p_id IS NOT NULL
  ON CONFLICT ("company_id", "kind", "entity_id") DO UPDATE SET "seq" = nextval('facts_queue_seq_seq'), "queued_at" = clock_timestamp()
$$;

-- A row of a table the figures come from changed: its order, or its inquiry.
CREATE FUNCTION facts_mark_row(p_table text, r jsonb) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  c uuid := (r ->> 'company_id')::uuid;
BEGIN
  CASE p_table
    WHEN 'orders' THEN
      PERFORM facts_enqueue(c, 'order', (r ->> 'id')::uuid);
    WHEN 'order_lines', 'order_costs', 'payments', 'payment_plan_items', 'factory_payments', 'factory_payment_plans',
         'shipments', 'order_factories', 'order_claims', 'order_bank_steps', 'expenses' THEN
      PERFORM facts_enqueue(c, 'order', (r ->> 'order_id')::uuid);
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

CREATE FUNCTION facts_mark() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN PERFORM facts_mark_row(TG_TABLE_NAME, to_jsonb(NEW)); END IF;
  IF TG_OP <> 'INSERT' THEN PERFORM facts_mark_row(TG_TABLE_NAME, to_jsonb(OLD)); END IF;
  RETURN NULL;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['orders', 'order_lines', 'order_costs', 'payments', 'payment_plan_items', 'factory_payments',
                           'factory_payment_plans', 'shipments', 'order_factories', 'order_claims', 'order_bank_steps', 'expenses',
                           'inquiries', 'factory_quotes', 'quotations', 'quotation_revisions', 'quotation_options'] LOOP
    EXECUTE format('CREATE TRIGGER facts_mark AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION facts_mark()', t);
  END LOOP;
END $$;

-- A customer's country moved: their inquiries (and with them their orders) are worked out again.
CREATE FUNCTION facts_mark_customer() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "facts_queue" ("company_id", "kind", "entity_id")
  SELECT i."company_id", 'inquiry', i."id" FROM "inquiries" i WHERE i."customer_id" = NEW."id"
  ON CONFLICT ("company_id", "kind", "entity_id") DO UPDATE SET "seq" = nextval('facts_queue_seq_seq'), "queued_at" = clock_timestamp();
  RETURN NULL;
END $$;
CREATE TRIGGER facts_mark AFTER UPDATE OF "country" ON "customers" FOR EACH ROW
  WHEN (OLD."country" IS DISTINCT FROM NEW."country") EXECUTE FUNCTION facts_mark_customer();

-- The main currency or the rates moved (Settings › Sales): the whole company is worked out again.
CREATE FUNCTION facts_mark_company() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM facts_enqueue(NEW."company_id", 'all', NEW."company_id");
  RETURN NULL;
END $$;
CREATE TRIGGER facts_mark AFTER INSERT OR UPDATE ON "settings" FOR EACH ROW
  WHEN (NEW."key" = 'sales') EXECUTE FUNCTION facts_mark_company();
