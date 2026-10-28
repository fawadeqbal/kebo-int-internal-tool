-- Companies: one database, shared tables, every company row tagged with company_id.
--
-- Isolation: the API reaches company data only through connections running as the
-- restricted role kebo_app with app.company_id set (startup options). Row-level
-- security on every company table lets such a connection see and change only rows
-- of its own company; with no company set it sees nothing. The platform tables
-- (companies, plans, leads, platform admins…) are not granted to kebo_app at all.
--
-- The data already here becomes the first company (Kebo): every existing row is
-- tagged with its id while the column is added.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kebo_app') THEN
    CREATE ROLE kebo_app NOLOGIN;
  END IF;
END $$;
GRANT kebo_app TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO kebo_app;

-- New company columns fill from this setting; for the rows already here it is Kebo.
SELECT set_config('app.company_id', '6b65626f-0000-4000-8000-000000000001', false);


-- CreateEnum
CREATE TYPE "CompanyKind" AS ENUM ('client', 'demo', 'trial');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('active', 'read_only', 'off', 'deleted');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('new', 'contacted', 'demo', 'client', 'lost');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('form', 'sign_up', 'manual');

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_role_fkey";

-- DropIndex
DROP INDEX "inquiries_ref_no_key";

-- DropIndex
DROP INDEX "money_accounts_name_key";

-- DropIndex
DROP INDEX "orders_proforma_no_key";

-- DropIndex
DROP INDEX "orders_ref_no_key";

-- DropIndex
DROP INDEX "quotations_ref_no_key";

-- DropIndex
DROP INDEX "roles_name_key";

-- DropIndex
DROP INDEX "users_email_key";

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "counters" DROP CONSTRAINT "counters_pkey",
ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
ADD CONSTRAINT "counters_pkey" PRIMARY KEY ("company_id", "key");

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "device_tokens" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "factories" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "factory_payments" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "factory_quote_lines" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "factory_quotes" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "inquiries" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "inquiry_assignments" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "inquiry_notes" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "inquiry_stage_changes" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "money_accounts" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "money_transfers" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "option_costs" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "order_lines" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "order_stage_changes" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "payment_plan_items" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "quotation_options" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "quotation_revisions" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "quotations" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "quote_lines" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "reminder_states" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "requested_items" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "roles" DROP CONSTRAINT "roles_pkey",
ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("company_id", "key");

-- AlterTable
ALTER TABLE "sales_targets" DROP CONSTRAINT "sales_targets_pkey",
ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
ADD CONSTRAINT "sales_targets_pkey" PRIMARY KEY ("company_id", "month");

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "settings" DROP CONSTRAINT "settings_pkey",
ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
ADD CONSTRAINT "settings_pkey" PRIMARY KEY ("company_id", "key");

-- AlterTable
ALTER TABLE "sign_ins" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
ADD COLUMN     "platform_admin_id" UUID;

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(30) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "kind" "CompanyKind" NOT NULL DEFAULT 'client',
    "status" "CompanyStatus" NOT NULL DEFAULT 'active',
    "status_reason" VARCHAR(200),
    "status_manual" BOOLEAN NOT NULL DEFAULT false,
    "plan_id" UUID,
    "starts_on" DATE NOT NULL DEFAULT CURRENT_DATE,
    "renews_on" DATE,
    "ends_at" TIMESTAMPTZ,
    "ending_notice_for" TIMESTAMPTZ,
    "previous_slug" VARCHAR(30),
    "previous_slug_until" TIMESTAMPTZ,
    "contact_name" VARCHAR(120),
    "contact_email" VARCHAR(254),
    "notes" TEXT,
    "last_active_at" TIMESTAMPTZ,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "description" VARCHAR(300),
    "price_minor" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "period" VARCHAR(10) NOT NULL DEFAULT 'month',
    "max_users" INTEGER,
    "max_storage_mb" INTEGER,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_payments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "paid_on" DATE NOT NULL,
    "paid_until" DATE NOT NULL,
    "note" VARCHAR(300),
    "recorded_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "company_name" VARCHAR(160) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "phone" VARCHAR(40),
    "country" VARCHAR(80),
    "team_size" VARCHAR(20),
    "message" TEXT,
    "source" "LeadSource" NOT NULL DEFAULT 'form',
    "status" "LeadStatus" NOT NULL DEFAULT 'new',
    "lost_reason" VARCHAR(300),
    "follow_up_on" DATE,
    "company_id" UUID,
    "ip" VARCHAR(64),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_notes" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "by_id" UUID,
    "by_name" VARCHAR(120),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "totp_secret" TEXT,
    "totp_enabled_at" TIMESTAMPTZ,
    "totp_last_step" INTEGER,
    "recovery_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_sessions" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "pending_two_step" BOOLEAN NOT NULL DEFAULT false,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(300),

    CONSTRAINT "platform_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_log" (
    "id" UUID NOT NULL,
    "admin_id" UUID,
    "admin_name" VARCHAR(120),
    "action" VARCHAR(60) NOT NULL,
    "company_id" UUID,
    "lead_id" UUID,
    "summary" TEXT NOT NULL,
    "details" JSONB,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sign_ups" (
    "id" UUID NOT NULL,
    "company_name" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(30) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "verified_at" TIMESTAMPTZ,
    "company_id" UUID,
    "ip" VARCHAR(64),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sign_ups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_slug_key" ON "companies"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "plans_name_key" ON "plans"("name");

-- CreateIndex
CREATE INDEX "subscription_payments_company_id_idx" ON "subscription_payments"("company_id");

-- CreateIndex
CREATE INDEX "leads_status_idx" ON "leads"("status");

-- CreateIndex
CREATE INDEX "leads_created_at_idx" ON "leads"("created_at");

-- CreateIndex
CREATE INDEX "lead_notes_lead_id_idx" ON "lead_notes"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins"("email");

-- CreateIndex
CREATE INDEX "platform_sessions_admin_id_idx" ON "platform_sessions"("admin_id");

-- CreateIndex
CREATE INDEX "platform_log_company_id_at_idx" ON "platform_log"("company_id", "at");

-- CreateIndex
CREATE INDEX "platform_log_at_idx" ON "platform_log"("at");

-- CreateIndex
CREATE UNIQUE INDEX "sign_ups_token_hash_key" ON "sign_ups"("token_hash");

-- CreateIndex
CREATE INDEX "sign_ups_email_idx" ON "sign_ups"("email");

-- CreateIndex
CREATE INDEX "attachments_company_id_idx" ON "attachments"("company_id");

-- CreateIndex
CREATE INDEX "audit_logs_company_id_idx" ON "audit_logs"("company_id");

-- CreateIndex
CREATE INDEX "contacts_company_id_idx" ON "contacts"("company_id");

-- CreateIndex
CREATE INDEX "customers_company_id_idx" ON "customers"("company_id");

-- CreateIndex
CREATE INDEX "device_tokens_company_id_idx" ON "device_tokens"("company_id");

-- CreateIndex
CREATE INDEX "expenses_company_id_idx" ON "expenses"("company_id");

-- CreateIndex
CREATE INDEX "factories_company_id_idx" ON "factories"("company_id");

-- CreateIndex
CREATE INDEX "factory_payments_company_id_idx" ON "factory_payments"("company_id");

-- CreateIndex
CREATE INDEX "factory_quote_lines_company_id_idx" ON "factory_quote_lines"("company_id");

-- CreateIndex
CREATE INDEX "factory_quotes_company_id_idx" ON "factory_quotes"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "inquiries_company_id_ref_no_key" ON "inquiries"("company_id", "ref_no");

-- CreateIndex
CREATE INDEX "inquiry_assignments_company_id_idx" ON "inquiry_assignments"("company_id");

-- CreateIndex
CREATE INDEX "inquiry_notes_company_id_idx" ON "inquiry_notes"("company_id");

-- CreateIndex
CREATE INDEX "inquiry_stage_changes_company_id_idx" ON "inquiry_stage_changes"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "money_accounts_company_id_name_key" ON "money_accounts"("company_id", "name");

-- CreateIndex
CREATE INDEX "money_transfers_company_id_idx" ON "money_transfers"("company_id");

-- CreateIndex
CREATE INDEX "notifications_company_id_idx" ON "notifications"("company_id");

-- CreateIndex
CREATE INDEX "option_costs_company_id_idx" ON "option_costs"("company_id");

-- CreateIndex
CREATE INDEX "order_lines_company_id_idx" ON "order_lines"("company_id");

-- CreateIndex
CREATE INDEX "order_stage_changes_company_id_idx" ON "order_stage_changes"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_company_id_ref_no_key" ON "orders"("company_id", "ref_no");

-- CreateIndex
CREATE UNIQUE INDEX "orders_company_id_proforma_no_key" ON "orders"("company_id", "proforma_no");

-- CreateIndex
CREATE INDEX "payment_plan_items_company_id_idx" ON "payment_plan_items"("company_id");

-- CreateIndex
CREATE INDEX "payments_company_id_idx" ON "payments"("company_id");

-- CreateIndex
CREATE INDEX "quotation_options_company_id_idx" ON "quotation_options"("company_id");

-- CreateIndex
CREATE INDEX "quotation_revisions_company_id_idx" ON "quotation_revisions"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_company_id_ref_no_key" ON "quotations"("company_id", "ref_no");

-- CreateIndex
CREATE INDEX "quote_lines_company_id_idx" ON "quote_lines"("company_id");

-- CreateIndex
CREATE INDEX "reminder_states_company_id_idx" ON "reminder_states"("company_id");

-- CreateIndex
CREATE INDEX "requested_items_company_id_idx" ON "requested_items"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_company_id_name_key" ON "roles"("company_id", "name");

-- CreateIndex
CREATE INDEX "sessions_company_id_idx" ON "sessions"("company_id");

-- CreateIndex
CREATE INDEX "sign_ins_company_id_idx" ON "sign_ins"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_company_id_email_key" ON "users"("company_id", "email");


-- The first company: the data that was already here.
INSERT INTO "companies" ("id", "slug", "name", "kind", "status", "starts_on", "updated_at")
SELECT '6b65626f-0000-4000-8000-000000000001', 'kebo',
       left(coalesce((SELECT "value"->>'name' FROM "settings" WHERE "key" = 'company'), 'Kebo'), 120),
       'client', 'active',
       coalesce((SELECT min("created_at")::date FROM "users"), CURRENT_DATE),
       CURRENT_TIMESTAMP;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_role_fkey" FOREIGN KEY ("company_id", "role") REFERENCES "roles"("company_id", "key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sign_ins" ADD CONSTRAINT "sign_ins_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counters" ADD CONSTRAINT "counters_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factories" ADD CONSTRAINT "factories_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requested_items" ADD CONSTRAINT "requested_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_stage_changes" ADD CONSTRAINT "inquiry_stage_changes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_assignments" ADD CONSTRAINT "inquiry_assignments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_notes" ADD CONSTRAINT "inquiry_notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_quotes" ADD CONSTRAINT "factory_quotes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_quote_lines" ADD CONSTRAINT "factory_quote_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_options" ADD CONSTRAINT "quotation_options_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_costs" ADD CONSTRAINT "option_costs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_stage_changes" ADD CONSTRAINT "order_stage_changes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_plan_items" ADD CONSTRAINT "payment_plan_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_payments" ADD CONSTRAINT "factory_payments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_accounts" ADD CONSTRAINT "money_accounts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_transfers" ADD CONSTRAINT "money_transfers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_states" ADD CONSTRAINT "reminder_states_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_sessions" ADD CONSTRAINT "platform_sessions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_log" ADD CONSTRAINT "platform_log_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Row-level security: a company connection sees and changes only its own rows.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['attachments', 'audit_logs', 'contacts', 'counters', 'customers', 'device_tokens', 'expenses', 'factories', 'factory_payments', 'factory_quote_lines', 'factory_quotes', 'inquiries', 'inquiry_assignments', 'inquiry_notes', 'inquiry_stage_changes', 'money_accounts', 'money_transfers', 'notifications', 'option_costs', 'order_lines', 'order_stage_changes', 'orders', 'payment_plan_items', 'payments', 'quotation_options', 'quotation_revisions', 'quotations', 'quote_lines', 'reminder_states', 'requested_items', 'roles', 'sales_targets', 'sessions', 'settings', 'sign_ins', 'users'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY company_isolation ON %I USING (company_id = nullif(current_setting(''app.company_id'', true), '''')::uuid) WITH CHECK (company_id = nullif(current_setting(''app.company_id'', true), '''')::uuid)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO kebo_app', t);
  END LOOP;
END $$;

SELECT set_config('app.company_id', '', false);
