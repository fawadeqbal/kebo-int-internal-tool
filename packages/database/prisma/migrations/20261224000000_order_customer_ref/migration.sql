-- The customer's own PO or reference for an order, given when they accept the quotation ("Their PO / reference").
ALTER TABLE "orders" ADD COLUMN "customer_ref" VARCHAR(80);
