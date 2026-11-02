-- Order flow v3: one checklist per order. Automatic items tick themselves from the order's data (their row,
-- when there is one, only keeps overrides: due date, person, skip, note); the company's own items are copied
-- from its list (checklist_templates) into an order the first time its checklist is read.
-- The production timeline moves into the checklist (step "production"); production_steps is kept for now
-- but no longer read or written.
-- Both new tables are company tables: company_id filled from the connection, row-level security, and every
-- link to another company table checked to stay inside the company.

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "checklist_seeded_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "order_checklist_items" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "order_id" UUID NOT NULL,
    "step" VARCHAR(20) NOT NULL,
    "key" VARCHAR(80),
    "title" VARCHAR(200),
    "tool" VARCHAR(10) NOT NULL DEFAULT 'done',
    "fields" JSONB NOT NULL DEFAULT '[]',
    "data" JSONB NOT NULL DEFAULT '{}',
    "route" "PaymentRoute",
    "factory_id" UUID,
    "due_on" DATE,
    "assignee_id" UUID,
    "done_at" TIMESTAMPTZ,
    "done_by" UUID,
    "skipped_at" TIMESTAMPTZ,
    "skip_reason" VARCHAR(300),
    "note" VARCHAR(1000),
    "attachment_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "order_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_templates" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT app_company(),
    "step" VARCHAR(20) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "tool" VARCHAR(10) NOT NULL DEFAULT 'done',
    "fields" JSONB NOT NULL DEFAULT '[]',
    "route" "PaymentRoute",
    "due_days" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_checklist_items_order_id_step_sort_order_idx" ON "order_checklist_items"("order_id", "step", "sort_order");

-- CreateIndex
CREATE INDEX "order_checklist_items_company_id_idx" ON "order_checklist_items"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_checklist_items_order_id_key_key" ON "order_checklist_items"("order_id", "key");

-- CreateIndex
CREATE INDEX "checklist_templates_company_id_step_sort_order_idx" ON "checklist_templates"("company_id", "step", "sort_order");

-- AddForeignKey
ALTER TABLE "order_checklist_items" ADD CONSTRAINT "order_checklist_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_checklist_items" ADD CONSTRAINT "order_checklist_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_checklist_items" ADD CONSTRAINT "order_checklist_items_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_checklist_items" ADD CONSTRAINT "order_checklist_items_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_checklist_items" ADD CONSTRAINT "order_checklist_items_done_by_fkey" FOREIGN KEY ("done_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_checklist_items" ADD CONSTRAINT "order_checklist_items_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_checklist_items" ADD CONSTRAINT "order_checklist_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Sensible values only.
ALTER TABLE "order_checklist_items" ADD CONSTRAINT "order_checklist_items_step_check" CHECK ("step" IN ('payment', 'factory', 'production', 'shipping', 'documents', 'delivery'));
ALTER TABLE "order_checklist_items" ADD CONSTRAINT "order_checklist_items_tool_check" CHECK ("tool" IN ('done', 'fill', 'upload', 'pay', 'make', 'send'));
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_step_check" CHECK ("step" IN ('payment', 'factory', 'production', 'shipping', 'documents', 'delivery'));
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_tool_check" CHECK ("tool" IN ('done', 'fill', 'upload', 'pay', 'make', 'send'));
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_due_days_check" CHECK ("due_days" IS NULL OR "due_days" BETWEEN 0 AND 3650);

-- Kept apart per company like every company table (see the companies and company_role migrations).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['order_checklist_items', 'checklist_templates'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY company_isolation ON %I USING (company_id = (SELECT app_company())) WITH CHECK (company_id = (SELECT app_company()))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO kebo_app', t);
  END LOOP;
END $$;

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

-- The production timeline moves into the checklist: each step becomes an own item of the Production step
-- (Mark done), with its planned date as the due date and its done date as when it was ticked.
INSERT INTO "order_checklist_items"
  ("id", "company_id", "order_id", "step", "title", "tool", "factory_id", "due_on", "done_at", "done_by", "note", "sort_order", "created_by", "created_at", "updated_at")
SELECT p."id", p."company_id", p."order_id", 'production', left(p."title", 200), 'done', p."factory_id", p."planned_on",
       CASE WHEN p."done_on" IS NULL THEN NULL ELSE (p."done_on"::timestamp AT TIME ZONE 'UTC') END,
       CASE WHEN p."done_on" IS NULL THEN NULL ELSE o."created_by" END,
       p."note", p."sort_order", o."created_by", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "production_steps" p
  JOIN "orders" o ON o."id" = p."order_id";

-- Those orders already have their list: the company's list is not copied into them on top.
UPDATE "orders" SET "checklist_seeded_at" = CURRENT_TIMESTAMP
 WHERE "id" IN (SELECT DISTINCT "order_id" FROM "production_steps");
