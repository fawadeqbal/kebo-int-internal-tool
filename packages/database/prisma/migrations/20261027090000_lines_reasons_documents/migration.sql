-- Step 1 of the roadmap: one line everywhere (items split into parts), a reason
-- on changes that affect others, URS & Documents, a person for each factory.

-- Why a change was made, shown in each record's history.
ALTER TABLE "audit_logs" ADD COLUMN "reason" TEXT;

-- Items split into parts at factory pricing (one level: a part has no parts).
ALTER TABLE "requested_items" ADD COLUMN "parent_id" UUID;
ALTER TABLE "requested_items" ADD CONSTRAINT "requested_items_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "requested_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "requested_items" ADD CONSTRAINT "requested_items_not_own_part" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");
CREATE INDEX "requested_items_parent_id_idx" ON "requested_items"("parent_id");

-- Files on a deal: what each one is, and a note.
ALTER TABLE "attachments" ADD COLUMN "kind" VARCHAR(20) NOT NULL DEFAULT 'other',
ADD COLUMN "note" VARCHAR(300);
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_kind_check" CHECK ("kind" IN ('urs', 'drawing', 'photo', 'specification', 'other'));

-- The person in our team who looks after each factory.
ALTER TABLE "factories" ADD COLUMN "owner_id" UUID;
ALTER TABLE "factories" ADD CONSTRAINT "factories_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "factories_owner_id_idx" ON "factories"("owner_id");
