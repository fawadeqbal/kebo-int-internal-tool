import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
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
    specifications: text("specifications").notNull(),
    quantity: integer("quantity").notNull().default(1),
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
  ],
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
    subtotal: money("subtotal"),
    discount: money("discount"),
    taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    taxAmount: money("tax_amount"),
    total: money("total"),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    submittedAt: date("submitted_at", { mode: "string" }),
    status: quotationStatusEnum("status").notNull().default("draft"),
    terms: text("terms"),
    notes: text("notes"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("quotations_query_idx").on(t.queryId),
    index("quotations_status_idx").on(t.status),
    uniqueIndex("quotations_query_version_uq").on(t.queryId, t.version),
  ],
);

export const quotationItems = pgTable("quotation_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  quotationId: uuid("quotation_id")
    .notNull()
    .references(() => quotations.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
  unitPrice: money("unit_price"),
  lineTotal: money("line_total"),
  sortOrder: integer("sort_order").notNull().default(0),
});

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
    subtotal: money("subtotal"),
    discount: money("discount"),
    taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    taxAmount: money("tax_amount"),
    total: money("total"),
    amountPaid: money("amount_paid"),
    status: invoiceStatusEnum("status").notNull().default("unpaid"),
    cancelReason: text("cancel_reason"),
    notes: text("notes"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index("invoices_status_idx").on(t.status),
    index("invoices_customer_idx").on(t.customerId),
    index("invoices_due_idx").on(t.dueDate),
  ],
);

export const invoiceItems = pgTable("invoice_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
  unitPrice: money("unit_price"),
  lineTotal: money("line_total"),
  sortOrder: integer("sort_order").notNull().default(0),
});

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
  attachments: many(attachments),
  comments: many(comments),
  statusHistory: many(queryStatusHistory),
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
export type Quotation = typeof quotations.$inferSelect;
export type QuotationStatus = (typeof quotationStatusEnum.enumValues)[number];
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceStatus = (typeof invoiceStatusEnum.enumValues)[number];
export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];
