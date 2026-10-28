-- The four ready-made plans (the platform admin changes or removes them freely;
-- a plan with the same name already there is left as it is). Same as DEFAULT_PLANS
-- in @kebo/shared. Companies without a plan (Kebo) keep every feature and no limits.
INSERT INTO "plans" ("id", "name", "description", "price_minor", "currency", "period", "max_users", "max_storage_mb", "features", "updated_at") VALUES
  (gen_random_uuid(), 'Starter',   'For a small team starting out: inquiries, quotations, orders and Excel.', 4900,  'USD', 'month', 3,    2048,  ARRAY['excel'], CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Team',      'Adds the mobile app, expenses, Insights and email reports.',              9900,  'USD', 'month', 10,   10240, ARRAY['excel','mobile_app','expenses','insights','email_reports'], CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Business',  'Everything: cash book, custom roles, audit log and the website form.',     19900, 'USD', 'month', 25,   51200, ARRAY['excel','mobile_app','expenses','insights','email_reports','cash_book','custom_roles','audit_log','website_form'], CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Unlimited', 'Everything, with no limit on people or files.',                           39900, 'USD', 'month', NULL, NULL,  ARRAY['excel','mobile_app','expenses','insights','email_reports','cash_book','custom_roles','audit_log','website_form'], CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
