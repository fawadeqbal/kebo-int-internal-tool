-- The translator follows the client's own words now (25 Nov 2026: their packing list's 小瓶封盖机, 全套, 附件,
-- 熏蒸实木箱（IPPC）) and writes the same way each time. What it wrote before and nobody has checked yet is written
-- again: those texts wait for it once more, and the order items printing them take the new Chinese. What a person
-- typed or checked stays as it is.
UPDATE "translations" SET "zh" = NULL, "by" = NULL, "status" = 'waiting', "tries" = 0, "error" = NULL, "next_try_at" = NULL
WHERE "by" = 'machine';
UPDATE "order_lines" SET "description_zh" = NULL, "zh_by" = NULL WHERE "zh_by" = 'machine';
