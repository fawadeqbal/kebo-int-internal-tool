-- Packing for machines, the rest (26 Nov 2026): a package can be inside another of the same order (a mixed pallet),
-- and a photo can show one package and its marks.

ALTER TABLE "order_line_cases" ADD COLUMN "in_package" VARCHAR(20);

ALTER TABLE "attachments" ADD COLUMN "package_no" VARCHAR(20);
