-- The inquiry, made simpler: two facts the offer and the quotation did not keep.
-- Warranty: what the factory gives on its offer, and what we give on our quotation (it starts from the
-- company's usual warranty in Settings and can be changed for one quotation; printed on it).
ALTER TABLE "factory_quotes"
  ADD COLUMN "warranty" VARCHAR(300);

-- How the quotation went to the customer (email, whatsapp, wechat, in_person, other), beside the day it was sent.
ALTER TABLE "quotation_revisions"
  ADD COLUMN "warranty" VARCHAR(300),
  ADD COLUMN "sent_via" VARCHAR(20);
