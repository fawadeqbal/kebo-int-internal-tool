-- The order without checklists, last step: every screen, reminder and paper now reads the order's own
-- data (its sections), so the checklist's tables go. The factory test's values were copied to
-- order_factories by 20261231000000_order_sections; files stay as files of their order.
DROP TABLE "order_checklist_items";
DROP TABLE "checklist_templates";

-- When the company's list was copied into the order: nothing is copied any more.
-- The originals' courier: kept as the "copies to the customer" step of order_bank_steps instead.
ALTER TABLE "orders"
  DROP COLUMN "checklist_seeded_at",
  DROP COLUMN "originals_courier",
  DROP COLUMN "originals_tracking_no",
  DROP COLUMN "originals_sent_on",
  DROP COLUMN "originals_note";
