-- What Kebo's proforma invoice shows: the customer's registration number,
-- a heading over the lines and the port of discharge.
ALTER TABLE "customers" ADD COLUMN "reg_no" VARCHAR(60);
ALTER TABLE "orders" ADD COLUMN "document_title" VARCHAR(200),
ADD COLUMN "port_of_discharge" VARCHAR(120);
