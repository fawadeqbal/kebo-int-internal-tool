-- Order flow, redesigned: the information the order did not keep.
-- The order: who the goods are consigned to, who is told, where they go, and the day of the customer's PO.
ALTER TABLE "orders"
  ADD COLUMN "consignee" TEXT,
  ADD COLUMN "notify_party" TEXT,
  ADD COLUMN "delivery_address" TEXT,
  ADD COLUMN "customer_po_on" DATE;

-- The shipment: the forwarder's person, the customs broker, tracking, freight and insurance, customs.
ALTER TABLE "shipments"
  ADD COLUMN "forwarder_contact" VARCHAR(120),
  ADD COLUMN "forwarder_phone" VARCHAR(40),
  ADD COLUMN "customs_broker" VARCHAR(120),
  ADD COLUMN "tracking_no" VARCHAR(80),
  ADD COLUMN "freight_amount" DECIMAL(14,2),
  ADD COLUMN "freight_currency" CHAR(3),
  ADD COLUMN "insurer" VARCHAR(120),
  ADD COLUMN "insurance_policy_no" VARCHAR(60),
  ADD COLUMN "customs_declaration_no" VARCHAR(60),
  ADD COLUMN "cleared_on" DATE;

-- Delivery: the day it was installed, and the warranty (months, counted from the SAT).
ALTER TABLE "order_deliveries"
  ADD COLUMN "installed_on" DATE,
  ADD COLUMN "warranty_months" INTEGER;
