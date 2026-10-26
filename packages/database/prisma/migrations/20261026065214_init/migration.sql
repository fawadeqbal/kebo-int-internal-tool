-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'manager', 'staff');

-- CreateEnum
CREATE TYPE "InquiryStage" AS ENUM ('new', 'sourcing', 'quoted', 'won', 'lost');

-- CreateEnum
CREATE TYPE "InquiryChannel" AS ENUM ('website', 'whatsapp', 'wechat', 'email', 'phone', 'visit', 'other');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "LostReason" AS ENUM ('price_too_high', 'no_reply', 'factory_cannot_supply', 'bought_elsewhere', 'customer_cancelled', 'duplicate_or_spam', 'other');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('company', 'individual');

-- CreateEnum
CREATE TYPE "TaxTreatment" AS ENUM ('export_zero_rated', 'domestic_vat');

-- CreateEnum
CREATE TYPE "RevisionStatus" AS ENUM ('draft', 'sent', 'accepted', 'rejected', 'expired', 'superseded');

-- CreateEnum
CREATE TYPE "LineType" AS ENUM ('goods', 'service', 'charge');

-- CreateEnum
CREATE TYPE "Incoterm" AS ENUM ('EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP');

-- CreateEnum
CREATE TYPE "BalanceTerms" AS ENUM ('before_shipment', 'against_bl_copy', 'after_arrival', 'letter_of_credit');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('open', 'closed', 'cancelled');

-- CreateEnum
CREATE TYPE "MilestoneKey" AS ENUM ('proforma_sent', 'customer_deposit', 'factory_order', 'factory_deposit', 'factory_confirmed', 'samples_approved', 'inspection_passed', 'customer_balance', 'factory_balance', 'shipped', 'documents_released', 'factory_vat_invoice');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('todo', 'done', 'skipped');

-- CreateEnum
CREATE TYPE "FactoryOrderStatus" AS ENUM ('draft', 'sent', 'confirmed', 'cancelled');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('in', 'out');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('deposit', 'balance', 'other');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('bank_transfer', 'letter_of_credit', 'cash', 'cheque', 'online', 'other');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('proforma', 'commercial');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'issued', 'void');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('planned', 'booked', 'departed', 'arrived');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'staff',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMPTZ,
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "totp_secret" TEXT,
    "totp_enabled_at" TIMESTAMPTZ,
    "totp_last_step" INTEGER,
    "recovery_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "user_agent" VARCHAR(300),
    "pending_two_step" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id" UUID,
    "token" TEXT NOT NULL,
    "platform" VARCHAR(20) NOT NULL DEFAULT 'android',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT,
    "link" VARCHAR(255),
    "dedupe_key" VARCHAR(200),
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "action" VARCHAR(60) NOT NULL,
    "entity_type" VARCHAR(60) NOT NULL,
    "entity_id" UUID,
    "summary" TEXT,
    "old_values" JSONB,
    "new_values" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "counters" (
    "key" VARCHAR(50) NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "counters_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "type" "CustomerType" NOT NULL DEFAULT 'company',
    "name" VARCHAR(200) NOT NULL,
    "country" CHAR(2) NOT NULL,
    "address" TEXT,
    "tax_no" VARCHAR(60),
    "tax_treatment" "TaxTreatment" NOT NULL DEFAULT 'export_zero_rated',
    "default_currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "notes" TEXT,
    "created_by" UUID,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "position" VARCHAR(80),
    "email" VARCHAR(254),
    "phone" VARCHAR(40),
    "whatsapp" VARCHAR(40),
    "wechat" VARCHAR(80),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "contact_person" VARCHAR(120),
    "phone" VARCHAR(40),
    "wechat" VARCHAR(80),
    "email" VARCHAR(254),
    "address" TEXT,
    "default_vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 13,
    "prices_include_vat" BOOLEAN NOT NULL DEFAULT true,
    "bank_details" TEXT,
    "notes" TEXT,
    "created_by" UUID,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "factories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inquiries" (
    "id" UUID NOT NULL,
    "ref_no" VARCHAR(30) NOT NULL,
    "customer_id" UUID NOT NULL,
    "contact_id" UUID,
    "channel" "InquiryChannel" NOT NULL DEFAULT 'email',
    "category" VARCHAR(120) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "requirements" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'normal',
    "required_by" DATE,
    "stage" "InquiryStage" NOT NULL DEFAULT 'new',
    "on_hold" BOOLEAN NOT NULL DEFAULT false,
    "lost_reason" "LostReason",
    "lost_note" TEXT,
    "assignee_id" UUID,
    "created_by" UUID NOT NULL,
    "closed_at" TIMESTAMPTZ,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requested_items" (
    "id" UUID NOT NULL,
    "inquiry_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "model" VARCHAR(120),
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit" VARCHAR(20) NOT NULL DEFAULT 'pcs',
    "target_price" DECIMAL(14,2),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "preferred_factory_line_id" UUID,

    CONSTRAINT "requested_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inquiry_stage_changes" (
    "id" UUID NOT NULL,
    "inquiry_id" UUID NOT NULL,
    "from_stage" "InquiryStage",
    "to_stage" "InquiryStage" NOT NULL,
    "cause" VARCHAR(40) NOT NULL DEFAULT 'manual',
    "lost_reason" "LostReason",
    "note" TEXT,
    "changed_by" UUID,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inquiry_stage_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inquiry_assignments" (
    "id" UUID NOT NULL,
    "inquiry_id" UUID NOT NULL,
    "assignee_id" UUID,
    "assigned_by" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inquiry_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inquiry_notes" (
    "id" UUID NOT NULL,
    "inquiry_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inquiry_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "inquiry_id" UUID NOT NULL,
    "milestone_id" UUID,
    "factory_quote_id" UUID,
    "payment_id" UUID,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(150) NOT NULL,
    "size" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factory_quotes" (
    "id" UUID NOT NULL,
    "inquiry_id" UUID NOT NULL,
    "factory_id" UUID NOT NULL,
    "reference" VARCHAR(80),
    "received_on" DATE NOT NULL,
    "valid_until" DATE,
    "currency" CHAR(3) NOT NULL DEFAULT 'CNY',
    "prices_include_vat" BOOLEAN NOT NULL DEFAULT true,
    "price_basis" VARCHAR(60),
    "lead_time" VARCHAR(120),
    "moq" VARCHAR(60),
    "payment_terms" TEXT,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "factory_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factory_quote_lines" (
    "id" UUID NOT NULL,
    "factory_quote_id" UUID NOT NULL,
    "requested_item_id" UUID,
    "description" TEXT NOT NULL,
    "model" VARCHAR(120),
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit" VARCHAR(20) NOT NULL DEFAULT 'pcs',
    "unit_price" DECIMAL(14,2) NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 13,
    "rebate_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "factory_quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" UUID NOT NULL,
    "ref_no" VARCHAR(30) NOT NULL,
    "inquiry_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_revisions" (
    "id" UUID NOT NULL,
    "quotation_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "RevisionStatus" NOT NULL DEFAULT 'draft',
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "incoterm" "Incoterm" NOT NULL DEFAULT 'FOB',
    "incoterm_place" VARCHAR(80),
    "deposit_percent" DECIMAL(5,2) NOT NULL DEFAULT 30,
    "balance_terms" "BalanceTerms" NOT NULL DEFAULT 'before_shipment',
    "lead_time" VARCHAR(120),
    "valid_until" DATE NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "prices_include_vat" BOOLEAN NOT NULL DEFAULT false,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "terms" TEXT,
    "notes" TEXT,
    "sent_on" DATE,
    "answered_on" DATE,
    "customer_snapshot" JSONB,
    "company_snapshot" JSONB,
    "created_by" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "quotation_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_lines" (
    "id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "requested_item_id" UUID,
    "type" "LineType" NOT NULL DEFAULT 'goods',
    "description" TEXT NOT NULL,
    "model" VARCHAR(120),
    "hs_code" VARCHAR(20),
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit" VARCHAR(20) NOT NULL DEFAULT 'pcs',
    "unit_price" DECIMAL(14,2) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,
    "unit_cost" DECIMAL(14,2),
    "factory_quote_line_id" UUID,
    "fx_rate" DECIMAL(14,6),
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "ref_no" VARCHAR(30) NOT NULL,
    "inquiry_id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'open',
    "ordered_on" DATE NOT NULL,
    "ship_by" DATE,
    "ready_on" DATE,
    "currency" CHAR(3) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "deposit_percent" DECIMAL(5,2) NOT NULL,
    "balance_terms" "BalanceTerms" NOT NULL,
    "incoterm" "Incoterm" NOT NULL,
    "incoterm_place" VARCHAR(80),
    "closed_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "cancel_reason" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "quote_line_id" UUID,
    "type" "LineType" NOT NULL DEFAULT 'goods',
    "description" TEXT NOT NULL,
    "model" VARCHAR(120),
    "hs_code" VARCHAR(20),
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit" VARCHAR(20) NOT NULL DEFAULT 'pcs',
    "unit_price" DECIMAL(14,2) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,
    "unit_cost" DECIMAL(14,2),
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestones" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "key" "MilestoneKey" NOT NULL,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'todo',
    "sort_order" INTEGER NOT NULL,
    "done_on" DATE,
    "done_by" UUID,
    "due_override" DATE,
    "assignee_id" UUID,
    "note" TEXT,
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone_events" (
    "id" UUID NOT NULL,
    "milestone_id" UUID NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "from_status" "MilestoneStatus" NOT NULL,
    "to_status" "MilestoneStatus" NOT NULL,
    "on" DATE,
    "note" TEXT,
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "by" UUID NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milestone_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factory_orders" (
    "id" UUID NOT NULL,
    "ref_no" VARCHAR(30) NOT NULL,
    "order_id" UUID NOT NULL,
    "factory_id" UUID NOT NULL,
    "status" "FactoryOrderStatus" NOT NULL DEFAULT 'draft',
    "currency" CHAR(3) NOT NULL DEFAULT 'CNY',
    "prices_include_vat" BOOLEAN NOT NULL DEFAULT true,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deposit_percent" DECIMAL(5,2) NOT NULL DEFAULT 30,
    "payment_terms" TEXT,
    "ready_on" DATE,
    "sent_on" DATE,
    "confirmed_on" DATE,
    "vat_invoice_no" VARCHAR(60),
    "vat_invoice_on" DATE,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "factory_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factory_order_lines" (
    "id" UUID NOT NULL,
    "factory_order_id" UUID NOT NULL,
    "order_line_id" UUID,
    "factory_quote_line_id" UUID,
    "description" TEXT NOT NULL,
    "model" VARCHAR(120),
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit" VARCHAR(20) NOT NULL DEFAULT 'pcs',
    "unit_price" DECIMAL(14,2) NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 13,
    "line_total" DECIMAL(14,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "factory_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "direction" "PaymentDirection" NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "order_id" UUID NOT NULL,
    "customer_id" UUID,
    "factory_id" UUID,
    "factory_order_id" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "bank_charges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "paid_on" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'bank_transfer',
    "reference" VARCHAR(120),
    "note" TEXT,
    "recorded_by" UUID NOT NULL,
    "voided_at" TIMESTAMPTZ,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "type" "InvoiceType" NOT NULL,
    "number" VARCHAR(30),
    "order_id" UUID NOT NULL,
    "shipment_id" UUID,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "issue_date" DATE,
    "due_date" DATE,
    "currency" CHAR(3) NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "prices_include_vat" BOOLEAN NOT NULL DEFAULT false,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deposit_percent" DECIMAL(5,2),
    "notes" TEXT,
    "void_reason" TEXT,
    "customer_snapshot" JSONB,
    "company_snapshot" JSONB,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "order_line_id" UUID,
    "type" "LineType" NOT NULL DEFAULT 'goods',
    "description" TEXT NOT NULL,
    "model" VARCHAR(120),
    "hs_code" VARCHAR(20),
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit" VARCHAR(20) NOT NULL DEFAULT 'pcs',
    "unit_price" DECIMAL(14,2) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "ref_no" VARCHAR(30) NOT NULL,
    "order_id" UUID NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'planned',
    "forwarder" VARCHAR(120),
    "port_of_loading" VARCHAR(120),
    "port_of_discharge" VARCHAR(120),
    "final_destination" VARCHAR(160),
    "transport" VARCHAR(160),
    "container_nos" VARCHAR(200),
    "seal_nos" VARCHAR(120),
    "bl_no" VARCHAR(60),
    "etd" DATE,
    "eta" DATE,
    "departed_on" DATE,
    "documents_released_on" DATE,
    "marks" TEXT,
    "notes" TEXT,
    "customer_snapshot" JSONB,
    "company_snapshot" JSONB,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_lines" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "order_line_id" UUID,
    "description" TEXT NOT NULL,
    "model" VARCHAR(120),
    "hs_code" VARCHAR(20),
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit" VARCHAR(20) NOT NULL DEFAULT 'pcs',
    "packages" INTEGER NOT NULL DEFAULT 1,
    "package_type" VARCHAR(40) NOT NULL DEFAULT 'Carton',
    "net_weight_kg" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "gross_weight_kg" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cbm" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "shipment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens"("token");

-- CreateIndex
CREATE INDEX "device_tokens_user_id_idx" ON "device_tokens"("user_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- CreateIndex
CREATE INDEX "customers_country_idx" ON "customers"("country");

-- CreateIndex
CREATE INDEX "contacts_customer_id_idx" ON "contacts"("customer_id");

-- CreateIndex
CREATE INDEX "contacts_email_idx" ON "contacts"("email");

-- CreateIndex
CREATE INDEX "contacts_phone_idx" ON "contacts"("phone");

-- CreateIndex
CREATE INDEX "contacts_whatsapp_idx" ON "contacts"("whatsapp");

-- CreateIndex
CREATE INDEX "factories_name_idx" ON "factories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "inquiries_ref_no_key" ON "inquiries"("ref_no");

-- CreateIndex
CREATE INDEX "inquiries_stage_idx" ON "inquiries"("stage");

-- CreateIndex
CREATE INDEX "inquiries_assignee_id_idx" ON "inquiries"("assignee_id");

-- CreateIndex
CREATE INDEX "inquiries_customer_id_idx" ON "inquiries"("customer_id");

-- CreateIndex
CREATE INDEX "inquiries_created_at_idx" ON "inquiries"("created_at");

-- CreateIndex
CREATE INDEX "requested_items_inquiry_id_idx" ON "requested_items"("inquiry_id");

-- CreateIndex
CREATE INDEX "inquiry_stage_changes_inquiry_id_idx" ON "inquiry_stage_changes"("inquiry_id");

-- CreateIndex
CREATE INDEX "inquiry_assignments_inquiry_id_idx" ON "inquiry_assignments"("inquiry_id");

-- CreateIndex
CREATE INDEX "inquiry_notes_inquiry_id_idx" ON "inquiry_notes"("inquiry_id");

-- CreateIndex
CREATE INDEX "attachments_inquiry_id_idx" ON "attachments"("inquiry_id");

-- CreateIndex
CREATE INDEX "attachments_milestone_id_idx" ON "attachments"("milestone_id");

-- CreateIndex
CREATE INDEX "factory_quotes_inquiry_id_idx" ON "factory_quotes"("inquiry_id");

-- CreateIndex
CREATE INDEX "factory_quotes_factory_id_idx" ON "factory_quotes"("factory_id");

-- CreateIndex
CREATE INDEX "factory_quote_lines_factory_quote_id_idx" ON "factory_quote_lines"("factory_quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_ref_no_key" ON "quotations"("ref_no");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_inquiry_id_key" ON "quotations"("inquiry_id");

-- CreateIndex
CREATE INDEX "quotation_revisions_status_idx" ON "quotation_revisions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_revisions_quotation_id_number_key" ON "quotation_revisions"("quotation_id", "number");

-- CreateIndex
CREATE INDEX "quote_lines_revision_id_idx" ON "quote_lines"("revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_ref_no_key" ON "orders"("ref_no");

-- CreateIndex
CREATE UNIQUE INDEX "orders_inquiry_id_key" ON "orders"("inquiry_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_revision_id_key" ON "orders"("revision_id");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_customer_id_idx" ON "orders"("customer_id");

-- CreateIndex
CREATE INDEX "order_lines_order_id_idx" ON "order_lines"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "milestones_order_id_key_key" ON "milestones"("order_id", "key");

-- CreateIndex
CREATE INDEX "milestone_events_milestone_id_idx" ON "milestone_events"("milestone_id");

-- CreateIndex
CREATE UNIQUE INDEX "factory_orders_ref_no_key" ON "factory_orders"("ref_no");

-- CreateIndex
CREATE INDEX "factory_orders_order_id_idx" ON "factory_orders"("order_id");

-- CreateIndex
CREATE INDEX "factory_orders_factory_id_idx" ON "factory_orders"("factory_id");

-- CreateIndex
CREATE INDEX "factory_order_lines_factory_order_id_idx" ON "factory_order_lines"("factory_order_id");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payments_direction_paid_on_idx" ON "payments"("direction", "paid_on");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE INDEX "invoices_order_id_idx" ON "invoices"("order_id");

-- CreateIndex
CREATE INDEX "invoices_status_due_date_idx" ON "invoices"("status", "due_date");

-- CreateIndex
CREATE INDEX "invoice_lines_invoice_id_idx" ON "invoice_lines"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_ref_no_key" ON "shipments"("ref_no");

-- CreateIndex
CREATE INDEX "shipments_order_id_idx" ON "shipments"("order_id");

-- CreateIndex
CREATE INDEX "shipment_lines_shipment_id_idx" ON "shipment_lines"("shipment_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requested_items" ADD CONSTRAINT "requested_items_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requested_items" ADD CONSTRAINT "requested_items_preferred_factory_line_id_fkey" FOREIGN KEY ("preferred_factory_line_id") REFERENCES "factory_quote_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_stage_changes" ADD CONSTRAINT "inquiry_stage_changes_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_assignments" ADD CONSTRAINT "inquiry_assignments_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_notes" ADD CONSTRAINT "inquiry_notes_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_factory_quote_id_fkey" FOREIGN KEY ("factory_quote_id") REFERENCES "factory_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_quotes" ADD CONSTRAINT "factory_quotes_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "inquiries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_quotes" ADD CONSTRAINT "factory_quotes_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_quote_lines" ADD CONSTRAINT "factory_quote_lines_factory_quote_id_fkey" FOREIGN KEY ("factory_quote_id") REFERENCES "factory_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_quote_lines" ADD CONSTRAINT "factory_quote_lines_requested_item_id_fkey" FOREIGN KEY ("requested_item_id") REFERENCES "requested_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "inquiries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "quotation_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_requested_item_id_fkey" FOREIGN KEY ("requested_item_id") REFERENCES "requested_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_factory_quote_line_id_fkey" FOREIGN KEY ("factory_quote_line_id") REFERENCES "factory_quote_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "inquiries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "quotation_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_quote_line_id_fkey" FOREIGN KEY ("quote_line_id") REFERENCES "quote_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_events" ADD CONSTRAINT "milestone_events_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_orders" ADD CONSTRAINT "factory_orders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_orders" ADD CONSTRAINT "factory_orders_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_order_lines" ADD CONSTRAINT "factory_order_lines_factory_order_id_fkey" FOREIGN KEY ("factory_order_id") REFERENCES "factory_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_order_lines" ADD CONSTRAINT "factory_order_lines_order_line_id_fkey" FOREIGN KEY ("order_line_id") REFERENCES "order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_order_lines" ADD CONSTRAINT "factory_order_lines_factory_quote_line_id_fkey" FOREIGN KEY ("factory_quote_line_id") REFERENCES "factory_quote_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_factory_order_id_fkey" FOREIGN KEY ("factory_order_id") REFERENCES "factory_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_order_line_id_fkey" FOREIGN KEY ("order_line_id") REFERENCES "order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_order_line_id_fkey" FOREIGN KEY ("order_line_id") REFERENCES "order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
