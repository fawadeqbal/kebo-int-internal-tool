-- A ready-made plan for companies that want less management: inquiries, factory prices,
-- quotations, orders and payments, without the import-flow modules. Added once; the
-- platform admin changes or retires it freely. Nothing existing changes.
INSERT INTO "plans" ("id", "name", "description", "price_minor", "currency", "period", "max_users", "max_storage_mb", "features", "is_active", "updated_at")
VALUES (gen_random_uuid(), 'Lite', 'Inquiries, factory prices, quotations, orders and payments. No shipping, bank or SAT tracking.', 2900, 'USD', 'month', 2, 1024, ARRAY['excel']::TEXT[], true, now())
ON CONFLICT ("name") DO NOTHING;
