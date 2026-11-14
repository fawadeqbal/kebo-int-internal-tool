-- Follow-ups the system sets itself (a new inquiry: reply to the customer; a quotation sent: follow up after
-- 3, 7, 14 days). It closes them when what they wait for happens.
ALTER TABLE "follow_ups" ADD COLUMN "auto" VARCHAR(10);
