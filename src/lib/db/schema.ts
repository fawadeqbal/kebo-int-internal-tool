import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/* ----------------------------------------------------------------------------
 * Enums — the single source of truth for every status in the system.
 * --------------------------------------------------------------------------*/
export const roleEnum = pgEnum("role", ["admin", "manager", "staff"]);
export const querySourceEnum = pgEnum("query_source", ["phone", "email", "whatsapp", "walk_in", "website", "other", "wechat"]);
export const priorityEnum = pgEnum("priority", ["low", "normal", "high", "urgent"]);
export const queryStatusEnum = pgEnum("query_status", ["pending", "processing", "completed", "not_completed"]);
export const quotationStatusEnum = pgEnum("quotation_status", ["draft", "sent", "accepted", "rejected", "expired"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["unpaid", "partially_paid", "paid", "cancelled"]);
export const paymentMethodEnum = pgEnum("payment_method", ["cash", "bank_transfer", "cheque", "online", "other", "lc"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** Money columns: exact decimals, never floating point. */
const money = (name: string) => numeric(name, { precision: 14, scale: 2 }).notNull().default("0");

/**
 * What every line has, on every document (requested item, quotation, invoice,
 * packing list): the item, its brand/model, how many and in which unit. The
 * description's first line is the item name; further lines are its details.
 */
const lineColumns = () => ({
  description: text("description").notNull(),
  model: varchar("model", { length: 120 }),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
  unit: varchar("unit", { length: 20 }).notNull().default("pcs"),
  sortOrder: integer("sort_order").notNull().default(0),
});

/** Who the document was for and who issued it, frozen when it is sent/issued (so old PDFs never change). */
export interface CustomerSnapshot {
  companyName: string | null;
  contactPerson: string;
  phone: string;
  email: string | null;
  address: string | null;
  taxNo: string | null;
}
export interface CompanySnapshot {
  companyName: string;
  companyNameLocal?: string;
  companyEmail2?: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  companyWebsite: string;
  companyTaxNo: string;
  bankDetails: string;
  invoiceFooter: string;
}

/* ----------------------------------------------------------------------------
 * Users
 * --------------------------------------------------------------------------*/
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 254 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("staff"),
  isActive: boolean("is_active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  /** Wrong passwords in a row; the account locks for a while after too many. */
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  /** Two-step sign-in: the authenticator secret (encrypted), set during setup; on once totpEnabledAt is set. */
  totpSecret: text("totp_secret"),
  totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
  /** Last 30-second step a code was accepted for, so a code can't be used twice. */
  totpLastStep: integer("totp_last_step"),
  /** sha256 hashes of the unused recovery codes. */
  recoveryCodes: jsonb("recovery_codes").$type<string[]>(),
  ...timestamps,
});

/**
 * One row per sign-in (browser / device). The cookie only carries the row's id,
 * so signing out, a password change or deactivating a user ends sessions on the
 * server at once. expiresAt slides forward while the session is used.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    userAgent: varchar("user_agent", { length: 300 }),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/* ----------------------------------------------------------------------------
 * Customers
 * --------------------------------------------------------------------------*/
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Optional — website inquiries may come from individuals. */
    companyName: varchar("company_name", { length: 200 }),
    contactPerson: varchar("contact_person", { length: 120 }).notNull(),
    email: varchar("email", { length: 254 }),
    phone: varchar("phone", { length: 40 }).notNull(),
    address: text("address"),
    taxNo: varchar("tax_no", { length: 60 }),
    /** Export customers etc.: their quotations and invoices carry no VAT. */
    vatExempt: boolean("vat_exempt").notNull().default(false),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("customers_company_idx").on(t.companyName),
    index("customers_phone_idx").on(t.phone),
    index("customers_email_idx").on(t.email),
  ],
);

/* ----------------------------------------------------------------------------
 * Queries / Orders
 * --------------------------------------------------------------------------*/
export const queries = pgTable(
  "queries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    refNo: varchar("ref_no", { length: 30 }).notNull().unique(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    source: querySourceEnum("source").notNull().default("phone"),
    title: varchar("title", { length: 200 }).notNull(),
    category: varchar("category", { length: 120 }),
    /** Anything else the customer said: destination port, delivery time, standards… (the items are in query_items). */
    specifications: text("specifications"),
    priority: priorityEnum("priority").notNull().default("normal"),
    requiredBy: date("required_by", { mode: "string" }),
    status: queryStatusEnum("status").notNull().default("pending"),
    statusReason: text("status_reason"),
    assignedTo: uuid("assigned_to").references(() => users.id),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("queries_status_idx").on(t.status),
    index("queries_assigned_idx").on(t.assignedTo),
    index("queries_customer_idx").on(t.customerId),
    index("queries_created_idx").on(t.createdAt),
    // Lets invoices/packing lists prove they belong to this inquiry's customer.
    unique("queries_id_customer_uq").on(t.id, t.customerId),
  ],
);

/** What the customer asked for, item by item. Quotation lines answer these. */
export const queryItems = pgTable(
  "query_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    queryId: uuid("query_id")
      .notNull()
      .references(() => queries.id, { onDelete: "cascade" }),
    ...lineColumns(),
    /** The factory offer line chosen for this item (its cost goes into the quotation). */
    chosenOfferItemId: uuid("chosen_offer_item_id").references((): AnyPgColumn => supplierQuoteItems.id, { onDelete: "set null" }),
  },
  (t) => [index("query_items_query_idx").on(t.queryId)],
);

/* ----------------------------------------------------------------------------
 * Sourcing: factories and what each one offered for an inquiry (internal only)
 * --------------------------------------------------------------------------*/
export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 200 }).notNull(),
    contactPerson: varchar("contact_person", { length: 120 }),
    phone: varchar("phone", { length: 40 }),
    wechat: varchar("wechat", { length: 80 }),
    email: varchar("email", { length: 254 }),
    address: text("address"),
    /** Their usual VAT: new prices from them start with it (an item can differ, e.g. 6% on services). */
    defaultVatRate: numeric("default_vat_rate", { precision: 5, scale: 2 }).notNull().default("13"),
    /** Whether their prices usually include that VAT. */
    pricesIncludeVat: boolean("prices_include_vat").notNull().default(true),
    bankDetails: text("bank_details"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("suppliers_name_idx").on(t.name)],
);

export const supplierQuotes = pgTable(
  "supplier_quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    queryId: uuid("query_id")
      .notNull()
      .references(() => queries.id),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    /** The factory's own quotation number, if any. */
    reference: varchar("reference", { length: 80 }),
    quotedOn: date("quoted_on", { mode: "string" }).notNull(),
    validUntil: date("valid_until", { mode: "string" }),
    currency: varchar("currency", { length: 3 }).notNull().default("CNY"),
    /** Whether the prices typed in already include VAT (each line has its own rate). */
    pricesIncludeVat: boolean("prices_include_vat").notNull().default(true),
    /** EXW, FOB Qingdao, delivered to port… */
    priceBasis: varchar("price_basis", { length: 60 }),
    leadTime: varchar("lead_time", { length: 120 }),
    paymentTerms: text("payment_terms"),
    notes: text("notes"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("supplier_quotes_query_idx").on(t.queryId), index("supplier_quotes_supplier_idx").on(t.supplierId)],
);

export const supplierQuoteItems = pgTable(
  "supplier_quote_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    supplierQuoteId: uuid("supplier_quote_id")
      .notNull()
      .references(() => supplierQuotes.id, { onDelete: "cascade" }),
    /** The customer's item this offer line is for (empty for extras the factory added). */
    queryItemId: uuid("query_item_id").references(() => queryItems.id, { onDelete: "set null" }),
    ...lineColumns(),
    unitPrice: money("unit_price"),
    vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  },
  (t) => [index("supplier_quote_items_quote_idx").on(t.supplierQuoteId)],
);

export const queryStatusHistory = pgTable(
  "query_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    queryId: uuid("query_id")
      .notNull()
      .references(() => queries.id, { onDelete: "cascade" }),
    fromStatus: queryStatusEnum("from_status"),
    toStatus: queryStatusEnum("to_status").notNull(),
    reason: text("reason"),
    changedBy: uuid("changed_by")
      .notNull()
      .references(() => users.id),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("qsh_query_idx").on(t.queryId)],
);

export const queryAssignments = pgTable(
  "query_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    queryId: uuid("query_id")
      .notNull()
      .references(() => queries.id, { onDelete: "cascade" }),
    assignedTo: uuid("assigned_to").references(() => users.id),
    assignedBy: uuid("assigned_by")
      .notNull()
      .references(() => users.id),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("qa_query_idx").on(t.queryId)],
);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    queryId: uuid("query_id")
      .notNull()
      .references(() => queries.id, { onDelete: "cascade" }),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    mimeType: varchar("mime_type", { length: 150 }).notNull(),
    size: integer("size").notNull(),
    storageKey: text("storage_key").notNull(),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("attachments_query_idx").on(t.queryId)],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    queryId: uuid("query_id")
      .notNull()
      .references(() => queries.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("comments_query_idx").on(t.queryId)],
);

/* ----------------------------------------------------------------------------
 * Quotations
 * --------------------------------------------------------------------------*/
export const quotations = pgTable(
  "quotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    refNo: varchar("ref_no", { length: 30 }).notNull().unique(),
    queryId: uuid("query_id")
      .notNull()
      .references(() => queries.id),
    version: integer("version").notNull().default(1),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    subtotal: money("subtotal"),
    discount: money("discount"),
    taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    /** VAT as set when the document was made: true = the prices already include it (Total incl. VAT), false = added on top. */
    pricesIncludeVat: boolean("prices_include_vat").notNull().default(false),
    taxAmount: money("tax_amount"),
    total: money("total"),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    submittedAt: date("submitted_at", { mode: "string" }),
    status: quotationStatusEnum("status").notNull().default("draft"),
    terms: text("terms"),
    notes: text("notes"),
    /** Set when marked sent. */
    customerSnapshot: jsonb("customer_snapshot").$type<CustomerSnapshot>(),
    companySnapshot: jsonb("company_snapshot").$type<CompanySnapshot>(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("quotations_query_idx").on(t.queryId),
    unique("quotations_id_query_uq").on(t.id, t.queryId),
    index("quotations_status_idx").on(t.status),
    uniqueIndex("quotations_query_version_uq").on(t.queryId, t.version),
  ],
);

export const quotationItems = pgTable(
  "quotation_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quotationId: uuid("quotation_id")
      .notNull()
      .references(() => quotations.id, { onDelete: "cascade" }),
    /** The requested item this line answers (empty for extras such as freight). */
    queryItemId: uuid("query_item_id").references(() => queryItems.id, { onDelete: "set null" }),
    ...lineColumns(),
    hsCode: varchar("hs_code", { length: 20 }),
    unitPrice: money("unit_price"),
    lineTotal: money("line_total"),
    /** Internal costing, never printed: the factory line it was priced from and what one unit costs us (incl. VAT, in the quotation's currency). */
    supplierQuoteItemId: uuid("supplier_quote_item_id").references(() => supplierQuoteItems.id, { onDelete: "set null" }),
    unitCost: numeric("unit_cost", { precision: 14, scale: 2 }),
    /** Units of the factory's currency per 1 unit of the quotation's currency, when it was priced. */
    fxRate: numeric("fx_rate", { precision: 14, scale: 6 }),
  },
  (t) => [index("quotation_items_quotation_idx").on(t.quotationId)],
);

/* ----------------------------------------------------------------------------
 * Invoices & payments
 * --------------------------------------------------------------------------*/
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceNo: varchar("invoice_no", { length: 30 }).notNull().unique(),
    quotationId: uuid("quotation_id")
      .notNull()
      .references(() => quotations.id),
    queryId: uuid("query_id")
      .notNull()
      .references(() => queries.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    issueDate: date("issue_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    subtotal: money("subtotal"),
    discount: money("discount"),
    taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    /** VAT as set when the document was made: true = the prices already include it (Total incl. VAT), false = added on top. */
    pricesIncludeVat: boolean("prices_include_vat").notNull().default(false),
    taxAmount: money("tax_amount"),
    total: money("total"),
    amountPaid: money("amount_paid"),
    status: invoiceStatusEnum("status").notNull().default("unpaid"),
    cancelReason: text("cancel_reason"),
    notes: text("notes"),
    customerSnapshot: jsonb("customer_snapshot").$type<CustomerSnapshot>(),
    companySnapshot: jsonb("company_snapshot").$type<CompanySnapshot>(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index("invoices_status_idx").on(t.status),
    unique("invoices_id_query_customer_uq").on(t.id, t.queryId, t.customerId),
    // The inquiry and customer are kept for fast lists/reports, and the database guarantees they match.
    foreignKey({ name: "invoices_quotation_query_fk", columns: [t.quotationId, t.queryId], foreignColumns: [quotations.id, quotations.queryId] }).onUpdate("cascade"),
    foreignKey({ name: "invoices_query_customer_fk", columns: [t.queryId, t.customerId], foreignColumns: [queries.id, queries.customerId] }).onUpdate("cascade"),
    index("invoices_customer_idx").on(t.customerId),
    index("invoices_due_idx").on(t.dueDate),
  ],
);

export const invoiceItems = pgTable(
  "invoice_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    /** The accepted quotation line this was invoiced from. */
    quotationItemId: uuid("quotation_item_id").references(() => quotationItems.id, { onDelete: "set null" }),
    ...lineColumns(),
    hsCode: varchar("hs_code", { length: 20 }),
    unitPrice: money("unit_price"),
    lineTotal: money("line_total"),
  },
  (t) => [index("invoice_items_invoice_idx").on(t.invoiceId)],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    amount: money("amount"),
    paidAt: date("paid_at", { mode: "string" }).notNull(),
    method: paymentMethodEnum("method").notNull().default("bank_transfer"),
    reference: varchar("reference", { length: 120 }),
    recordedBy: uuid("recorded_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payments_invoice_idx").on(t.invoiceId)],
);

/* ----------------------------------------------------------------------------
 * Packing lists (shipping document made from an invoice; no prices)
 * --------------------------------------------------------------------------*/
export const packingLists = pgTable(
  "packing_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    plNo: varchar("pl_no", { length: 30 }).notNull().unique(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    queryId: uuid("query_id")
      .notNull()
      .references(() => queries.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    packDate: date("pack_date", { mode: "string" }).notNull(),
    incoterm: varchar("incoterm", { length: 60 }),
    portOfLoading: varchar("port_of_loading", { length: 120 }),
    portOfDischarge: varchar("port_of_discharge", { length: 120 }),
    finalDestination: varchar("final_destination", { length: 160 }),
    /** Vessel / voyage, flight or truck. */
    transport: varchar("transport", { length: 160 }),
    containerNo: varchar("container_no", { length: 200 }),
    sealNo: varchar("seal_no", { length: 120 }),
    marks: text("marks"),
    notes: text("notes"),
    customerSnapshot: jsonb("customer_snapshot").$type<CustomerSnapshot>(),
    companySnapshot: jsonb("company_snapshot").$type<CompanySnapshot>(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // One shipment per invoice.
    uniqueIndex("packing_lists_invoice_uq").on(t.invoiceId).where(sql`${t.deletedAt} is null`),
    index("packing_lists_query_idx").on(t.queryId),
    foreignKey({ name: "packing_lists_invoice_party_fk", columns: [t.invoiceId, t.queryId, t.customerId], foreignColumns: [invoices.id, invoices.queryId, invoices.customerId] }).onUpdate("cascade"),
  ],
);

export const packingListItems = pgTable("packing_list_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  packingListId: uuid("packing_list_id")
    .notNull()
    .references(() => packingLists.id, { onDelete: "cascade" }),
  /** The invoice line being shipped (description, model, quantity and unit come from it). */
  invoiceItemId: uuid("invoice_item_id").references(() => invoiceItems.id, { onDelete: "set null" }),
  ...lineColumns(),
  hsCode: varchar("hs_code", { length: 20 }),
  /** Number of packages (cartons, cases, pallets) for this line. */
  packages: integer("packages").notNull().default(1),
  packageType: varchar("package_type", { length: 40 }).notNull().default("Wooden case"),
  netWeight: numeric("net_weight", { precision: 12, scale: 2 }).notNull().default("0"),
  grossWeight: numeric("gross_weight", { precision: 12, scale: 2 }).notNull().default("0"),
  /** Volume of this line's packages, cubic metres. */
  cbm: numeric("cbm", { precision: 12, scale: 3 }).notNull().default("0"),
});

/* ----------------------------------------------------------------------------
 * Notifications, audit, settings, counters
 * --------------------------------------------------------------------------*/
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 60 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    body: text("body"),
    link: varchar("link", { length: 255 }),
    /** Prevents the reminder job from sending the same reminder twice. */
    dedupeKey: varchar("dedupe_key", { length: 200 }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId, t.readAt),
    uniqueIndex("notifications_dedupe_uq")
      .on(t.userId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
  ],
);

/** Phones signed in to the mobile app, for push notifications (Firebase Cloud Messaging). */
export const deviceTokens = pgTable(
  "device_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The app sign-in this phone belongs to: no push once it is signed out, revoked or expired. */
    sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    platform: varchar("platform", { length: 20 }).notNull().default("android"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("device_tokens_token_uq").on(t.token), index("device_tokens_user_idx").on(t.userId)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id),
    action: varchar("action", { length: 60 }).notNull(),
    entityType: varchar("entity_type", { length: 60 }).notNull(),
    entityId: uuid("entity_id"),
    summary: text("summary"),
    oldValues: jsonb("old_values"),
    newValues: jsonb("new_values"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_created_idx").on(t.createdAt)],
);

export const settings = pgTable("settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Gap-free yearly counters for reference numbers (QRY-2026-0001, INV-2026-0001…). */
export const counters = pgTable("counters", {
  key: varchar("key", { length: 50 }).primaryKey(),
  value: integer("value").notNull().default(0),
});

/* ----------------------------------------------------------------------------
 * Relations (used by the query builder)
 * --------------------------------------------------------------------------*/
export const customersRelations = relations(customers, ({ many }) => ({ queries: many(queries) }));

export const queriesRelations = relations(queries, ({ one, many }) => ({
  customer: one(customers, { fields: [queries.customerId], references: [customers.id] }),
  assignee: one(users, { fields: [queries.assignedTo], references: [users.id], relationName: "assignee" }),
  creator: one(users, { fields: [queries.createdBy], references: [users.id], relationName: "creator" }),
  quotations: many(quotations),
  items: many(queryItems),
  attachments: many(attachments),
  comments: many(comments),
  statusHistory: many(queryStatusHistory),
}));

export const queryItemsRelations = relations(queryItems, ({ one }) => ({
  query: one(queries, { fields: [queryItems.queryId], references: [queries.id] }),
}));

export const quotationsRelations = relations(quotations, ({ one, many }) => ({
  query: one(queries, { fields: [quotations.queryId], references: [queries.id] }),
  items: many(quotationItems),
  creator: one(users, { fields: [quotations.createdBy], references: [users.id] }),
}));

export const quotationItemsRelations = relations(quotationItems, ({ one }) => ({
  quotation: one(quotations, { fields: [quotationItems.quotationId], references: [quotations.id] }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  quotation: one(quotations, { fields: [invoices.quotationId], references: [quotations.id] }),
  query: one(queries, { fields: [invoices.queryId], references: [queries.id] }),
  customer: one(customers, { fields: [invoices.customerId], references: [customers.id] }),
  items: many(invoiceItems),
  payments: many(payments),
}));

export const invoiceItemsRelations = relations(invoiceItems, ({ one }) => ({
  invoice: one(invoices, { fields: [invoiceItems.invoiceId], references: [invoices.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  invoice: one(invoices, { fields: [payments.invoiceId], references: [invoices.id] }),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  query: one(queries, { fields: [attachments.queryId], references: [queries.id] }),
  uploader: one(users, { fields: [attachments.uploadedBy], references: [users.id] }),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  query: one(queries, { fields: [comments.queryId], references: [queries.id] }),
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
}));

export const queryStatusHistoryRelations = relations(queryStatusHistory, ({ one }) => ({
  query: one(queries, { fields: [queryStatusHistory.queryId], references: [queries.id] }),
  user: one(users, { fields: [queryStatusHistory.changedBy], references: [users.id] }),
}));

export type User = typeof users.$inferSelect;
export type Role = (typeof roleEnum.enumValues)[number];
export type Customer = typeof customers.$inferSelect;
export type Query = typeof queries.$inferSelect;
export type QueryStatus = (typeof queryStatusEnum.enumValues)[number];
export type QuerySource = (typeof querySourceEnum.enumValues)[number];
export type Priority = (typeof priorityEnum.enumValues)[number];
export type QueryItem = typeof queryItems.$inferSelect;
export type Supplier = typeof suppliers.$inferSelect;
export type SupplierQuote = typeof supplierQuotes.$inferSelect;
export type SupplierQuoteItem = typeof supplierQuoteItems.$inferSelect;
export type Quotation = typeof quotations.$inferSelect;
export type QuotationStatus = (typeof quotationStatusEnum.enumValues)[number];
export type Invoice = typeof invoices.$inferSelect;
export type PackingList = typeof packingLists.$inferSelect;
export type InvoiceStatus = (typeof invoiceStatusEnum.enumValues)[number];
export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];
