-- A factory offer's line can be another spec of one of its lines (the press in 35 and 41 stations):
-- shown as a choice beside that line and left out of the offer's total.
ALTER TABLE "factory_quote_lines" ADD COLUMN "alternative_of_id" UUID;
ALTER TABLE "factory_quote_lines" ADD CONSTRAINT "factory_quote_lines_alternative_of_id_fkey"
  FOREIGN KEY ("alternative_of_id") REFERENCES "factory_quote_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "factory_quote_lines_alternative_of_id_idx" ON "factory_quote_lines"("alternative_of_id");
