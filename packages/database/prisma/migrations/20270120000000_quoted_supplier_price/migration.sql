-- The supplier's price each quotation line was quoted from (canvas "From the supplier offer to the quotation",
-- change 7, 19 Nov 2026): when the offer's price changes after the quotation was made, the quotation says so and
-- offers to update. Lines quoted before this keep null (nothing is said about them).

-- AlterTable
ALTER TABLE "quote_lines" ADD COLUMN     "factory_unit_price" DECIMAL(14,2);
