-- Papers in Chinese and the China customs copy (25 Nov 2026): each goods line's name in Chinese (under the English
-- on papers in English + 中文) and who wrote it, and China's HS code for it (the supplier's: it can differ from the
-- customer's country's after the first six digits). Empty: the same as the customer's.

ALTER TABLE "order_lines" ADD COLUMN "hs_code_cn" VARCHAR(20),
  ADD COLUMN "description_zh" TEXT,
  ADD COLUMN "zh_by" VARCHAR(10);

ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_zh_by_check" CHECK ("zh_by" IS NULL OR "zh_by" IN ('machine', 'staff'));
