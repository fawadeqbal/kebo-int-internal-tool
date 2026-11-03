-- Fixes (3 Nov 2026): "Drawings approved by the customer", "Materials and parts in" and "Machining and
-- assembly" are no longer in the built-in checklist (DEFAULT_CHECKLIST). Orders that got them keep only
-- the ones somebody used: an item still open and untouched (never ticked or skipped, nothing filled in,
-- no file, no note) is removed. Ticked ones stay as history. Company lists (checklist_templates) are the
-- company's own choice and are left alone.
DELETE FROM "order_checklist_items"
 WHERE "key" IS NULL
   AND "step" = 'production'
   AND "title" IN ('Drawings approved by the customer', 'Materials and parts in', 'Machining and assembly')
   AND "done_at" IS NULL
   AND "done_by" IS NULL
   AND "skipped_at" IS NULL
   AND "attachment_id" IS NULL
   AND "note" IS NULL
   AND ("data" IS NULL OR "data" = '{}'::jsonb);
