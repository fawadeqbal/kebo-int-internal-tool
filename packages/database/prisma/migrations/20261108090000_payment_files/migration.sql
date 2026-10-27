-- A photo or PDF proving a payment (bank slip, transfer screenshot), customer and factory.
ALTER TABLE "payments" ADD COLUMN "file_key" TEXT,
ADD COLUMN "file_name" VARCHAR(255),
ADD COLUMN "file_type" VARCHAR(150),
ADD COLUMN "file_size" INTEGER;

ALTER TABLE "factory_payments" ADD COLUMN "file_key" TEXT,
ADD COLUMN "file_name" VARCHAR(255),
ADD COLUMN "file_type" VARCHAR(150),
ADD COLUMN "file_size" INTEGER;
