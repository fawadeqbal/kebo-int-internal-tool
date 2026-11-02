-- How a factory was asked for a price (WeChat, email…). Only adds an empty column.
ALTER TABLE "factory_requests" ADD COLUMN "channel" VARCHAR(20);
ALTER TABLE "factory_requests" ADD CONSTRAINT "factory_requests_channel_check"
  CHECK ("channel" IS NULL OR "channel" IN ('wechat', 'email', 'whatsapp', 'phone', 'visit', 'other'));
