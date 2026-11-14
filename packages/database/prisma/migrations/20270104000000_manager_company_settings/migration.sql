-- Clean-up (14 Nov 2026): Settings is two groups in the menu. A manager may use the company's own
-- settings (Company settings); people, roles and security stay with the admin. The Manager role every
-- company started with gets the permission; roles a company made itself are left as they are.
UPDATE "roles"
SET "permissions" = array_append("permissions", 'settings.manage')
WHERE "key" = 'manager' AND NOT "super_admin" AND NOT ('settings.manage' = ANY("permissions"));
