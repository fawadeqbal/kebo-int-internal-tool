/**
 * One-time import of the old app's database (legacy/, Drizzle) into the new
 * Prisma database, following docs/revamp-plan.md ("Data import mapping").
 *
 *   DATABASE_URL=<new database> pnpm db:import-legacy --from <old DATABASE_URL> [--dry-run]
 *
 * - Reads the old database in one read-only snapshot; never writes to it.
 * - Writes everything in ONE transaction: any failure (or a totals mismatch)
 *   leaves the new database exactly as it was.
 * - Refuses to run when the new database already has inquiries.
 * - --dry-run does the whole import, prints the report and rolls back.
 * - Old ids are kept as the new ids wherever a row maps one-to-one, so every
 *   link (files, audit log entries, costing lines) survives. Old reference
 *   numbers (RFQ, QUO, INV, PL) are kept, and the counters continue after them.
 *
 * The mapping rules themselves are pure functions in ./import-legacy/map.ts.
 */
import "./env";
import { randomUUID } from "node:crypto";
import { Client, types as pgTypes } from "pg";
import { fromMinor, toMinor } from "@kebo/money";
import type { BalanceTerms, Incoterm, InquiryStage } from "@kebo/shared";
import { dateIn, type ISODate } from "@kebo/utils";
import { createPrismaClient, nextReference, toDbDate, type Prisma } from "../src";
import * as map from "./import-legacy/map";

/* ---------------------------------------------------------------- arguments */

function parseArgs(argv: string[]) {
  let from: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--from") from = argv[++i];
    else if (argv[i].startsWith("--from=")) from = argv[i].slice("--from=".length);
  }
  return { from, dryRun: argv.includes("--dry-run") };
}

const TZ = process.env.APP_TIME_ZONE ?? "Asia/Shanghai";
const SYSTEM_EMAIL = "website-form@system.local";

/* ---------------------------------------------------------------- old rows */

type Ts = Date;
interface OldUser { id: string; name: string; email: string; password_hash: string; role: "admin" | "manager" | "staff"; is_active: boolean; last_login_at: Ts | null; failed_logins: number; locked_until: Ts | null; totp_secret: string | null; totp_enabled_at: Ts | null; totp_last_step: number | null; recovery_codes: unknown; created_at: Ts; updated_at: Ts }
interface OldCustomer { id: string; company_name: string | null; contact_person: string; email: string | null; phone: string; address: string | null; tax_no: string | null; vat_exempt: boolean; notes: string | null; created_by: string | null; deleted_at: Ts | null; created_at: Ts; updated_at: Ts }
interface OldQuery { id: string; ref_no: string; customer_id: string; source: map.LegacySource; title: string; category: string | null; specifications: string | null; priority: "low" | "normal" | "high" | "urgent"; required_by: ISODate | null; status: map.LegacyQueryStatus; status_reason: string | null; assigned_to: string | null; created_by: string; completed_at: Ts | null; deleted_at: Ts | null; created_at: Ts; updated_at: Ts }
interface OldLine { id: string; description: string; model: string | null; quantity: string; unit: string; sort_order: number }
interface OldQueryItem extends OldLine { query_id: string; chosen_offer_item_id: string | null }
interface OldSupplier { id: string; name: string; contact_person: string | null; phone: string | null; wechat: string | null; email: string | null; address: string | null; default_vat_rate: string; prices_include_vat: boolean; bank_details: string | null; notes: string | null; created_by: string | null; deleted_at: Ts | null; created_at: Ts; updated_at: Ts }
interface OldSupplierQuote { id: string; query_id: string; supplier_id: string; reference: string | null; quoted_on: ISODate; valid_until: ISODate | null; currency: string; prices_include_vat: boolean; price_basis: string | null; lead_time: string | null; payment_terms: string | null; notes: string | null; created_by: string; deleted_at: Ts | null; created_at: Ts; updated_at: Ts }
interface OldSupplierQuoteItem extends OldLine { supplier_quote_id: string; query_item_id: string | null; unit_price: string; vat_rate: string }
interface OldHistory { id: string; query_id: string; from_status: map.LegacyQueryStatus | null; to_status: map.LegacyQueryStatus; reason: string | null; changed_by: string; changed_at: Ts }
interface OldAssignment { id: string; query_id: string; assigned_to: string | null; assigned_by: string; assigned_at: Ts }
interface OldAttachment { id: string; query_id: string; file_name: string; mime_type: string; size: number; storage_key: string; uploaded_by: string; deleted_at: Ts | null; created_at: Ts }
interface OldComment { id: string; query_id: string; body: string; author_id: string; created_at: Ts }
interface OldQuotation { id: string; ref_no: string; query_id: string; version: number; currency: string; subtotal: string; discount: string; tax_rate: string; prices_include_vat: boolean; tax_amount: string; total: string; due_date: ISODate; submitted_at: ISODate | null; status: map.LegacyQuotationStatus; terms: string | null; notes: string | null; customer_snapshot: unknown; company_snapshot: unknown; created_by: string; deleted_at: Ts | null; created_at: Ts; updated_at: Ts }
interface OldQuotationItem extends OldLine { quotation_id: string; query_item_id: string | null; hs_code: string | null; unit_price: string; line_total: string; supplier_quote_item_id: string | null; unit_cost: string | null; fx_rate: string | null }
interface OldInvoice { id: string; invoice_no: string; quotation_id: string; query_id: string; customer_id: string; issue_date: ISODate; due_date: ISODate; currency: string; subtotal: string; discount: string; tax_rate: string; prices_include_vat: boolean; tax_amount: string; total: string; amount_paid: string; status: "unpaid" | "partially_paid" | "paid" | "cancelled"; cancel_reason: string | null; notes: string | null; customer_snapshot: unknown; company_snapshot: unknown; created_by: string; created_at: Ts; updated_at: Ts }
interface OldInvoiceItem extends OldLine { invoice_id: string; quotation_item_id: string | null; hs_code: string | null; unit_price: string; line_total: string }
interface OldPayment { id: string; invoice_id: string; amount: string; paid_at: ISODate; method: map.LegacyPaymentMethod; reference: string | null; recorded_by: string; created_at: Ts }
interface OldPackingList { id: string; pl_no: string; invoice_id: string; query_id: string; pack_date: ISODate; incoterm: string | null; port_of_loading: string | null; port_of_discharge: string | null; final_destination: string | null; transport: string | null; container_no: string | null; seal_no: string | null; marks: string | null; notes: string | null; customer_snapshot: unknown; company_snapshot: unknown; created_by: string; deleted_at: Ts | null; created_at: Ts; updated_at: Ts }
interface OldPackingItem extends OldLine { packing_list_id: string; invoice_item_id: string | null; hs_code: string | null; packages: number; package_type: string; net_weight: string; gross_weight: string; cbm: string }
interface OldAudit { id: string; user_id: string | null; action: string; entity_type: string; entity_id: string | null; summary: string | null; old_values: unknown; new_values: unknown; created_at: Ts }

async function readLegacy(url: string) {
  // DATE columns as plain "YYYY-MM-DD" strings (no time zone shifts); NUMERIC stays a string.
  const client = new Client({
    connectionString: url,
    types: { getTypeParser: ((oid: number, format?: "text" | "binary") => (oid === 1082 ? (v: string) => v : pgTypes.getTypeParser(oid, format))) as typeof pgTypes.getTypeParser },
  });
  await client.connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    const all = async <T>(sql: string) => (await client.query(sql)).rows as T[];
    const data = {
      users: await all<OldUser>("select * from users order by created_at, id"),
      customers: await all<OldCustomer>("select * from customers order by created_at, id"),
      suppliers: await all<OldSupplier>("select * from suppliers order by created_at, id"),
      queries: await all<OldQuery>("select * from queries order by ref_no"),
      queryItems: await all<OldQueryItem>("select * from query_items order by query_id, sort_order, id"),
      supplierQuotes: await all<OldSupplierQuote>("select * from supplier_quotes order by created_at, id"),
      supplierQuoteItems: await all<OldSupplierQuoteItem>("select * from supplier_quote_items order by supplier_quote_id, sort_order, id"),
      history: await all<OldHistory>("select * from query_status_history order by query_id, changed_at, id"),
      assignments: await all<OldAssignment>("select * from query_assignments order by query_id, assigned_at, id"),
      attachments: await all<OldAttachment>("select * from attachments order by created_at, id"),
      comments: await all<OldComment>("select * from comments order by created_at, id"),
      quotations: await all<OldQuotation>("select * from quotations order by query_id, version"),
      quotationItems: await all<OldQuotationItem>("select * from quotation_items order by quotation_id, sort_order, id"),
      invoices: await all<OldInvoice>("select * from invoices order by invoice_no"),
      invoiceItems: await all<OldInvoiceItem>("select * from invoice_items order by invoice_id, sort_order, id"),
      payments: await all<OldPayment>("select * from payments order by paid_at, created_at, id"),
      packingLists: await all<OldPackingList>("select * from packing_lists order by pl_no"),
      packingItems: await all<OldPackingItem>("select * from packing_list_items order by packing_list_id, sort_order, id"),
      auditLogs: await all<OldAudit>("select * from audit_logs order by created_at, id"),
      settings: await all<{ key: string; value: unknown }>("select key, value from settings"),
      counters: await all<{ key: string; value: number }>("select key, value from counters"),
      skipped: (
        await all<{ sessions: string; notifications: string; device_tokens: string }>(
          "select (select count(*) from sessions) sessions, (select count(*) from notifications) notifications, (select count(*) from device_tokens) device_tokens",
        )
      )[0],
    };
    await client.query("rollback");
    return data;
  } finally {
    await client.end();
  }
}
type Legacy = Awaited<ReturnType<typeof readLegacy>>;

/* ---------------------------------------------------------------- helpers */

const groupBy = <T, K>(xs: T[], key: (x: T) => K) => {
  const m = new Map<K, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = m.get(k);
    if (list) list.push(x);
    else m.set(k, [x]);
  }
  return m;
};
const sumMinor = (xs: { toString(): string }[]) => xs.reduce<number>((s, x) => s + toMinor(x), 0);
const json = (v: unknown) => (v === null || v === undefined ? undefined : (v as Prisma.InputJsonValue));
const dayOf = (ts: Date) => dateIn(ts, TZ);
const later = (a: Date, b: Date) => (a > b ? a : b);

class Report {
  counts: { what: string; old: number | string; new: number | string }[] = [];
  judgements = new Map<string, string[]>();
  totals: { what: string; old: string; new: string; ok: boolean }[] = [];
  judge(topic: string, item: string) {
    const list = this.judgements.get(topic) ?? [];
    list.push(item);
    this.judgements.set(topic, list);
  }
  print(log: (s: string) => void) {
    log("\nCounts (old → new)");
    const w = Math.max(...this.counts.map((c) => c.what.length));
    for (const c of this.counts) log(`  ${c.what.padEnd(w)}  ${String(c.old).padStart(5)} → ${c.new}`);
    log("\nTotals checks");
    for (const t of this.totals) log(`  ${t.ok ? "OK      " : "MISMATCH"}  ${t.what}: old ${t.old}, new ${t.new}`);
    log("\nJudgement calls");
    if (!this.judgements.size) log("  (none)");
    for (const [topic, items] of this.judgements) {
      log(`  ${topic} (${items.length})`);
      for (const i of items) log(`    - ${i}`);
    }
  }
}

/* ---------------------------------------------------------------- the import */

async function importAll(tx: Prisma.TransactionClient, old: Legacy, report: Report) {
  const now = new Date();
  const legacySettings = (old.settings.find((s) => s.key === "app")?.value ?? {}) as Record<string, unknown>;
  const settings = map.mapSettings(legacySettings);

  /* ---- people */
  await tx.user.createMany({
    data: old.users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      passwordHash: u.password_hash,
      role: u.role,
      isActive: u.is_active,
      lastLoginAt: u.last_login_at,
      failedLogins: u.failed_logins,
      lockedUntil: u.locked_until,
      totpSecret: u.totp_secret,
      totpEnabledAt: u.totp_enabled_at,
      totpLastStep: u.totp_last_step,
      recoveryCodes: Array.isArray(u.recovery_codes) ? (u.recovery_codes as string[]) : [],
      createdAt: u.created_at,
      updatedAt: u.updated_at,
    })),
  });
  if (!(await tx.user.findUnique({ where: { email: SYSTEM_EMAIL } }))) {
    await tx.user.create({ data: { email: SYSTEM_EMAIL, name: "Website form", role: "staff", isSystem: true, isActive: false, passwordHash: "!" } });
    report.judge("Added (not in the old data)", `system account ${SYSTEM_EMAIL} (records website inquiries; cannot sign in)`);
  }
  const withTotp = old.users.filter((u) => u.totp_enabled_at);
  if (withTotp.length)
    report.judge("Two-step sign-in secrets copied as they are (the new API must use the old encryption key)", withTotp.map((u) => u.email).join(", "));

  /* ---- settings */
  for (const [key, value] of Object.entries(settings.values)) {
    await tx.setting.upsert({ where: { key }, update: { value: value as Prisma.InputJsonValue }, create: { key, value: value as Prisma.InputJsonValue } });
  }
  for (const d of settings.dropped) report.judge("Old settings with no place in the new ones (dropped)", d);
  for (const p of settings.problems) report.judge("Settings that could not be read (defaults used)", p);
  report.judge(
    "Settings derived",
    `sales.defaultDepositPercent = ${settings.values.sales.defaultDepositPercent} (read from the old default quotation terms; default 30 when they do not say); reminders.newDays/sourcingDays/dueSoonDays from reminderPendingDays/reminderProcessingDays/reminderDueSoonDays; plan timings are the new defaults`,
  );

  /* ---- customers + one primary contact */
  const contactOf = new Map<string, string>();
  for (const c of old.customers) contactOf.set(c.id, randomUUID());
  await tx.customer.createMany({
    data: old.customers.map((c) => ({
      id: c.id,
      type: c.company_name?.trim() ? ("company" as const) : ("individual" as const),
      name: c.company_name?.trim() || c.contact_person,
      country: map.UNKNOWN_COUNTRY,
      address: c.address,
      taxNo: c.tax_no,
      defaultCurrency: settings.values.sales.currency,
      notes: c.notes,
      createdById: c.created_by,
      deletedAt: c.deleted_at,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    })),
  });
  await tx.contact.createMany({
    data: old.customers.map((c) => ({
      id: contactOf.get(c.id)!,
      customerId: c.id,
      name: c.contact_person,
      email: c.email,
      phone: c.phone,
      isPrimary: true,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    })),
  });
  for (const c of old.customers) {
    const hint = map.countryHintFromPhone(c.phone);
    report.judge(`Customers without a country (set to "${map.UNKNOWN_COUNTRY}", fill in)`, `${c.company_name?.trim() || c.contact_person} (${c.phone}${hint ? `, phone suggests ${hint}` : ""})`);
  }
  const individuals = old.customers.filter((c) => !c.company_name?.trim());
  for (const c of individuals) report.judge("Customers with no company name → type individual, named after the contact", c.contact_person);

  /* ---- factories */
  await tx.factory.createMany({
    data: old.suppliers.map((s) => ({
      id: s.id,
      name: s.name,
      contactPerson: s.contact_person,
      phone: s.phone,
      wechat: s.wechat,
      email: s.email,
      address: s.address,
      bankDetails: s.bank_details,
      notes: s.notes,
      createdById: s.created_by,
      deletedAt: s.deleted_at,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    })),
  });

  /* ---- what each deal became */
  const versionsOf = groupBy(old.quotations, (q) => q.query_id);
  const invoicesOfQuotation = groupBy(old.invoices, (i) => i.quotation_id);
  const acceptedAudit = new Map<string, ISODate>();
  for (const a of old.auditLogs) {
    const nv = a.new_values as { status?: string } | null;
    if (a.entity_type === "quotation" && a.action === "status_change" && nv?.status === "accepted" && a.entity_id) acceptedAudit.set(a.entity_id, dayOf(a.created_at));
  }

  interface Deal {
    q: OldQuery;
    stage: map.StageResult;
    revisions: Map<string, map.RevisionMapping>;
    accepted: OldQuotation | null;
    orderedOn: ISODate | null;
    incoterm: { incoterm: Incoterm; place: string | null };
  }
  const deals = new Map<string, Deal>();
  const packingByInvoice = groupBy(
    old.packingLists.filter((p) => !p.deleted_at),
    (p) => p.invoice_id,
  );
  let incotermDefaulted = 0;
  for (const q of old.queries) {
    const versions = (versionsOf.get(q.id) ?? []).filter((v) => !v.deleted_at);
    const facts: map.StageFacts = {
      status: q.status,
      assigned: !!q.assigned_to,
      quotationSent: versions.some((v) => map.wasSent(v.status)),
      quotationAccepted: versions.some((v) => v.status === "accepted"),
      statusReason: q.status_reason,
    };
    const stage = map.mapInquiryStage(facts);
    if (stage.judgement) report.judge("Inquiry stages", `${q.ref_no}: ${stage.judgement}`);
    const revisions = map.mapRevisionStatuses(
      (versionsOf.get(q.id) ?? []).map((v) => ({ id: v.id, version: v.version, status: v.status, deleted: !!v.deleted_at })),
      { orderCancelled: stage.orderCancelled },
    );
    for (const [id, r] of revisions) {
      if (r.judgement) report.judge("Quotation revisions", `${old.quotations.find((v) => v.id === id)!.ref_no}: ${r.judgement}`);
    }
    const accepted = (versionsOf.get(q.id) ?? []).find((v) => ["accepted", "void"].includes(revisions.get(v.id)!.status)) ?? null;

    // Trade term: the old quotations had none; the packing list's "CIF Karachi" is the only record of it.
    const pls = (versionsOf.get(q.id) ?? []).flatMap((v) => (invoicesOfQuotation.get(v.id) ?? []).flatMap((i) => packingByInvoice.get(i.id) ?? []));
    let incoterm = { incoterm: "FOB" as Incoterm, place: null as string | null };
    const withTerm = pls.find((p) => p.incoterm?.trim());
    const parsed = map.parseIncoterm(withTerm?.incoterm);
    if (parsed) incoterm = parsed;
    else if (withTerm) report.judge("Trade terms that could not be read (FOB used)", `${q.ref_no}: "${withTerm.incoterm}"`);
    else if (versions.length) incotermDefaulted++;

    let orderedOn: ISODate | null = null;
    if (accepted) {
      const firstInvoice = (invoicesOfQuotation.get(accepted.id) ?? []).map((i) => i.issue_date).sort()[0] ?? null;
      const a = map.acceptanceDate({
        auditOn: acceptedAudit.get(accepted.id) ?? null,
        updatedOn: dayOf(accepted.updated_at),
        sentOn: accepted.submitted_at,
        createdOn: dayOf(accepted.created_at),
        firstInvoiceOn: firstInvoice,
      });
      orderedOn = a.date;
      if (a.inferred) report.judge("Order dates inferred (the old app kept no acceptance date)", `${q.ref_no}: ${a.date}`);
    }
    deals.set(q.id, { q, stage, revisions, accepted, orderedOn, incoterm });
  }
  if (incotermDefaulted)
    report.judge("Trade terms", `${incotermDefaulted} quoted deals have no packing list to read a trade term from → FOB, no place (old quotations had no trade-term field); deals with a packing list take it from there (e.g. "CIF Karachi")`);

  /* ---- inquiries */
  const noCategory = old.queries.filter((q) => !q.category?.trim());
  if (noCategory.length) report.judge('Inquiries without a category → "Other"', noCategory.map((q) => q.ref_no).join(", "));
  const closedAtOf = (d: Deal): Date | null => {
    if (d.stage.stage !== "won" && d.stage.stage !== "lost") return null;
    return d.q.completed_at ?? (d.orderedOn ? toDbDate(d.orderedOn) : d.q.updated_at);
  };
  await tx.inquiry.createMany({
    data: [...deals.values()].map((d) => ({
      id: d.q.id,
      refNo: d.q.ref_no,
      customerId: d.q.customer_id,
      contactId: contactOf.get(d.q.customer_id) ?? null,
      channel: map.mapChannel(d.q.source),
      category: d.q.category?.trim() || "Other",
      title: d.q.title,
      requirements: d.q.specifications,
      priority: d.q.priority,
      requiredBy: d.q.required_by ? toDbDate(d.q.required_by) : null,
      stage: d.stage.stage,
      lostReason: d.stage.lostReason,
      lostNote: d.stage.lostNote,
      assigneeId: d.q.assigned_to,
      createdById: d.q.created_by,
      closedAt: closedAtOf(d),
      deletedAt: d.q.deleted_at,
      createdAt: d.q.created_at,
      updatedAt: d.q.updated_at,
    })),
  });

  await tx.requestedItem.createMany({
    data: old.queryItems.map((i) => ({ id: i.id, inquiryId: i.query_id, description: i.description, model: i.model, quantity: i.quantity, unit: i.unit, sortOrder: i.sort_order })),
  });

  /* ---- stage history */
  const historyOf = groupBy(old.history, (h) => h.query_id);
  const stageRows: Prisma.InquiryStageChangeCreateManyInput[] = [];
  let synthetic = 0;
  for (const d of deals.values()) {
    const acceptedFlag = !!d.accepted;
    const rows: Prisma.InquiryStageChangeCreateManyInput[] = (historyOf.get(d.q.id) ?? []).map((h) => {
      const to = map.mapHistoryStage(h.to_status, acceptedFlag);
      return {
        id: h.id,
        inquiryId: d.q.id,
        fromStage: h.from_status ? map.mapHistoryStage(h.from_status, acceptedFlag) : null,
        toStage: to,
        cause: h.from_status ? "manual" : "created",
        lostReason: to === "lost" ? "other" : null,
        note: h.reason,
        changedById: h.changed_by,
        changedAt: h.changed_at,
      };
    });
    if (!rows.length) rows.push({ id: randomUUID(), inquiryId: d.q.id, fromStage: null, toStage: "new", cause: "created", changedById: d.q.created_by, changedAt: d.q.created_at });
    const last = rows[rows.length - 1];
    if (last.toStage !== d.stage.stage) {
      const firstSent = (versionsOf.get(d.q.id) ?? []).map((v) => v.submitted_at).filter((x): x is string => !!x).sort()[0];
      const evidence: Date =
        d.stage.stage === "won" && d.orderedOn ? toDbDate(d.orderedOn) : d.stage.stage === "quoted" && firstSent ? toDbDate(firstSent) : (d.q.completed_at ?? d.q.updated_at);
      rows.push({
        id: randomUUID(),
        inquiryId: d.q.id,
        fromStage: last.toStage as InquiryStage,
        toStage: d.stage.stage,
        cause: "legacy_import",
        lostReason: d.stage.lostReason,
        note: "Stage worked out from the old data at import.",
        changedById: null,
        changedAt: later(evidence, last.changedAt as Date),
      });
      synthetic++;
    }
    stageRows.push(...rows);
  }
  await tx.inquiryStageChange.createMany({ data: stageRows });
  if (synthetic) report.judge("Stage history", `${synthetic} inquiries got one extra stage change (cause "legacy_import") because their final stage differs from the last mapped old status (old processing → quoted/won, assigned pending → sourcing…)`);

  await tx.inquiryAssignment.createMany({
    data: old.assignments.map((a) => ({ id: a.id, inquiryId: a.query_id, assigneeId: a.assigned_to, assignedById: a.assigned_by, assignedAt: a.assigned_at })),
  });
  await tx.inquiryNote.createMany({ data: old.comments.map((c) => ({ id: c.id, inquiryId: c.query_id, body: c.body, authorId: c.author_id, createdAt: c.created_at })) });
  await tx.attachment.createMany({
    data: old.attachments.map((a) => ({
      id: a.id,
      inquiryId: a.query_id,
      fileName: a.file_name,
      mimeType: a.mime_type,
      size: a.size,
      storageKey: a.storage_key,
      uploadedById: a.uploaded_by,
      deletedAt: a.deleted_at,
      createdAt: a.created_at,
    })),
  });

  /* ---- factory prices: always without tax now, with one tax % per quote added on top */
  const quoteIncludesVat = new Map(old.supplierQuotes.map((s) => [s.id, s.prices_include_vat]));
  await tx.factoryQuote.createMany({
    data: old.supplierQuotes.map((s) => ({
      id: s.id,
      inquiryId: s.query_id,
      factoryId: s.supplier_id,
      reference: s.reference,
      receivedOn: toDbDate(s.quoted_on),
      validUntil: s.valid_until ? toDbDate(s.valid_until) : null,
      currency: s.currency,
      priceBasis: s.price_basis,
      leadTime: s.lead_time,
      paymentTerms: s.payment_terms,
      notes: s.notes,
      createdById: s.created_by,
      deletedAt: s.deleted_at,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    })),
  });
  await tx.factoryQuoteLine.createMany({
    data: old.supplierQuoteItems.map((l) => ({
      id: l.id,
      factoryQuoteId: l.supplier_quote_id,
      requestedItemId: l.query_item_id,
      description: l.description,
      model: l.model,
      quantity: l.quantity,
      unit: l.unit,
      // Prices entered with tax are stored without it (same cost).
      unitPrice: quoteIncludesVat.get(l.supplier_quote_id) && Number(l.vat_rate) > 0 ? (Math.round((Number(l.unit_price) / (1 + Number(l.vat_rate) / 100)) * 100) / 100).toFixed(2) : l.unit_price,
      // Tax on top of the item's price, as the old app had it per line.
      taxRate: Number(l.vat_rate) || 0,
      sortOrder: l.sort_order,
    })),
  });

  /* ---- quotations: one per deal, each old version a revision */
  const quotationRows: Prisma.QuotationCreateManyInput[] = [];
  const revisionRows: Prisma.QuotationRevisionCreateManyInput[] = [];
  const renumbered: { revisionId: string; ref: string; parent: string; version: number }[] = [];
  let depositDefaulted = 0;
  const revisionTerms = new Map<string, { depositPercent: number; balanceTerms: BalanceTerms }>();
  for (const d of deals.values()) {
    const versions = versionsOf.get(d.q.id) ?? [];
    if (!versions.length) continue;
    const parentId = randomUUID();
    const parentRef = versions[0].ref_no; // the first version's number names the quotation
    quotationRows.push({ id: parentId, refNo: parentRef, inquiryId: d.q.id, createdAt: versions[0].created_at });
    for (const v of versions) {
      const m = d.revisions.get(v.id)!;
      const fromTerms = map.depositPercentFromTerms(v.terms);
      if (fromTerms === null) depositDefaulted++;
      const depositPercent = fromTerms ?? settings.values.sales.defaultDepositPercent;
      const balanceTerms: BalanceTerms = "before_shipment";
      revisionTerms.set(v.id, { depositPercent, balanceTerms });
      const answered = v.status === "accepted" ? d.orderedOn : v.status === "rejected" || v.status === "expired" ? dayOf(v.updated_at) : null;
      revisionRows.push({
        id: v.id,
        quotationId: parentId,
        number: v.version,
        status: m.status,
        currency: v.currency,
        incoterm: d.incoterm.incoterm,
        incotermPlace: d.incoterm.place,
        depositPercent,
        balanceTerms,
        validUntil: toDbDate(v.due_date),
        // Sales carry no tax; an old version with tax keeps its total (reported below).
        subtotal: v.subtotal,
        discount: v.discount,
        total: v.total,
        paymentTerms: v.terms,
        notes: v.notes,
        sentOn: v.submitted_at ? toDbDate(v.submitted_at) : null,
        answeredOn: answered ? toDbDate(answered) : null,
        customerSnapshot: json(v.customer_snapshot),
        companySnapshot: json(v.company_snapshot),
        createdById: v.created_by,
        deletedAt: v.deleted_at ?? (m.discard ? now : null),
        createdAt: v.created_at,
        updatedAt: v.updated_at,
      });
      if (v.ref_no !== parentRef) renumbered.push({ revisionId: v.id, ref: v.ref_no, parent: parentRef, version: v.version });
    }
  }
  await tx.quotation.createMany({ data: quotationRows });
  await tx.quotationRevision.createMany({ data: revisionRows });
  // Each old version had one set of lines: it becomes Option A of its revision.
  const optionOf = new Map(revisionRows.map((r) => [r.id!, randomUUID()]));
  await tx.quotationOption.createMany({
    data: revisionRows.map((r) => ({
      id: optionOf.get(r.id!)!,
      revisionId: r.id!,
      letter: "A",
      status: r.status === "accepted" || r.status === "void" ? ("accepted" as const) : ("open" as const),
      leadTime: r.leadTime ?? null,
      subtotal: r.subtotal,
      discount: r.discount,
      total: r.total,
    })),
  });
  for (const v of old.quotations.filter((q) => Number(q.tax_amount) !== 0)) report.judge("Quotations with tax (sales carry no tax now; the total is kept)", `${v.ref_no} v${v.version}: tax ${v.tax_amount}`);
  if (depositDefaulted)
    report.judge("Deposit %", `${depositDefaulted} quotation versions whose terms do not state an "N% advance/deposit" → ${settings.values.sales.defaultDepositPercent}%`);
  report.judge("Payment terms", "old quotations had no balance-terms field → before_shipment on every revision and order (deposit % read from the terms text, e.g. \"30% advance\")");
  for (const r of renumbered) report.judge("Later versions numbered under the first version's quotation (old number kept in the audit log)", `${r.ref} → ${r.parent} R${r.version}`);

  const quoteLines = old.quotationItems;
  await tx.quoteLine.createMany({
    data: quoteLines.map((l) => ({
      id: l.id,
      revisionId: l.quotation_id,
      optionId: optionOf.get(l.quotation_id)!,
      requestedItemId: l.query_item_id,
      type: map.lineType(l.description),
      description: l.description,
      model: l.model,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: l.unit_price,
      lineTotal: l.line_total,
      unitCost: l.unit_cost,
      factoryQuoteLineId: l.supplier_quote_item_id,
      fxRate: l.fx_rate,
      sortOrder: l.sort_order,
    })),
  });
  const charges = quoteLines.filter((l) => map.lineType(l.description) === "charge").length;
  report.judge("Line types", `${charges} of ${quoteLines.length} quotation lines → charge (first line matches the old isServiceLine words: freight, insurance, inspection…), the rest goods; invoice lines the same way`);

  /* ---- orders for accepted revisions */
  const linesOfQuotation = groupBy(quoteLines, (l) => l.quotation_id);
  const invoicesOfQuery = groupBy(old.invoices, (i) => i.query_id);
  const paymentsOfInvoice = groupBy(old.payments, (p) => p.invoice_id);
  const orderOfRevision = new Map<string, string>();
  const orderOfInquiry = new Map<string, { id: string; customerId: string; currency: string }>();
  const orderLineOfQuoteLine = new Map<string, string>();
  const ordered = [...deals.values()].filter((d) => d.accepted).sort((a, b) => (a.orderedOn! < b.orderedOn! ? -1 : a.orderedOn! > b.orderedOn! ? 1 : a.q.ref_no < b.q.ref_no ? -1 : 1));
  const statusCount = { open: 0, closed: 0, cancelled: 0 };
  for (const d of ordered) {
    const rev = d.accepted!;
    const terms = revisionTerms.get(rev.id)!;
    const invoices = (invoicesOfQuery.get(d.q.id) ?? []).filter((i) => i.status !== "cancelled");
    const payments = (invoicesOfQuery.get(d.q.id) ?? []).flatMap((i) => (paymentsOfInvoice.get(i.id) ?? []).map((p) => ({ p, invoiceNo: i.invoice_no })));
    // Only packing lists of invoices that still stand count as goods that left.
    const shipments = invoices.flatMap((i) => packingByInvoice.get(i.id) ?? []);
    const totalMinor = toMinor(rev.total);
    const paymentFacts = payments.map(({ p, invoiceNo }) => ({ ref: `${p.reference ?? "payment"} on ${invoiceNo}`, on: p.paid_at, by: p.recorded_by, amountMinor: toMinor(p.amount) }));
    const paidInFull = paymentFacts.reduce((sum, p) => sum + p.amountMinor, 0) >= totalMinor && totalMinor > 0;
    const status = map.orderStatusFor({ legacyStatus: d.q.status, paidInFull, shipped: shipments.length > 0 });
    const closedOn = d.q.completed_at ? dayOf(d.q.completed_at) : null;
    const staged = map.inferStage({
      status,
      orderedOn: d.orderedOn!,
      closedOn,
      depositPercent: terms.depositPercent,
      totalMinor,
      payments: paymentFacts,
      shipments: shipments.map((s) => ({ ref: s.pl_no, on: s.pack_date, by: s.created_by })),
    });
    statusCount[status]++;
    const id = randomUUID();
    const refNo = await nextReference(tx, "order", Number(d.orderedOn!.slice(0, 4)));
    await tx.order.create({
      data: {
        id,
        refNo,
        inquiryId: d.q.id,
        revisionId: rev.id,
        customerId: d.q.customer_id,
        status,
        stage: staged.stage,
        stageSince: toDbDate(staged.since),
        shippedOn: staged.shippedOn ? toDbDate(staged.shippedOn) : null,
        orderedOn: toDbDate(d.orderedOn!),
        currency: rev.currency,
        total: rev.total,
        depositPercent: terms.depositPercent,
        balanceTerms: terms.balanceTerms,
        incoterm: d.incoterm.incoterm,
        incotermPlace: d.incoterm.place,
        closedAt: status === "closed" ? (d.q.completed_at ?? now) : null,
        cancelledAt: status === "cancelled" ? (d.q.completed_at ?? d.q.updated_at) : null,
        cancelReason: status === "cancelled" ? (d.q.status_reason ?? "Closed as not completed in the old app.") : null,
        createdById: rev.created_by,
        createdAt: toDbDate(d.orderedOn!),
      },
    });
    orderOfRevision.set(rev.id, id);
    orderOfInquiry.set(d.q.id, { id, customerId: d.q.customer_id, currency: rev.currency });
    const lines = linesOfQuotation.get(rev.id) ?? [];
    const lineRows = lines.map((l) => {
      const lineId = randomUUID();
      orderLineOfQuoteLine.set(l.id, lineId);
      return {
        id: lineId,
        orderId: id,
        quoteLineId: l.id,
        type: map.lineType(l.description),
        description: l.description,
        model: l.model,
          quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unit_price,
        lineTotal: l.line_total,
        unitCost: l.unit_cost,
        sortOrder: l.sort_order,
      };
    });
    await tx.orderLine.createMany({ data: lineRows });
    await tx.orderStageChange.createMany({
      data: staged.history.map((h, i) => ({ id: randomUUID(), orderId: id, fromStage: i === 0 ? null : staged.history[i - 1]!.to, toStage: h.to, note: h.note, at: toDbDate(h.on) })),
    });
  }
  report.judge(
    "Orders",
    `one per accepted revision: ${statusCount.open} open, ${statusCount.closed} closed (old "completed" + paid in full + packing list), ${statusCount.cancelled} cancelled. Stage: closed → Done; a packing list → Shipped; payments reaching the deposit → In production; otherwise Confirmed (each step in the order's history with a note)`,
  );

  /* ---- packing lists → each order's packing list (packages, weights, CBM per line; container and marks) */
  const deletedPls = old.packingLists.filter((p) => p.deleted_at);
  for (const p of deletedPls) report.judge("Deleted packing lists skipped", p.pl_no);
  const invoiceById = new Map(old.invoices.map((i) => [i.id, i]));
  const orderForInvoice = (i: OldInvoice) => {
    const o = orderOfRevision.get(i.quotation_id) ?? orderOfInquiry.get(i.query_id)?.id;
    if (!o) throw new Error(`Invoice ${i.invoice_no} belongs to no accepted quotation, so it has no order to go on.`);
    return o;
  };
  const livePls = old.packingLists.filter((p) => !p.deleted_at).sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
  const invoiceItemById = new Map(old.invoiceItems.map((i) => [i.id, i]));
  const liveIds = new Set(livePls.map((p) => p.id));
  const packed = new Map<string, { packages: number; packageType: string | null; net: number; gross: number; cbm: number }>();
  let unmatched = 0;
  for (const l of old.packingItems.filter((i) => liveIds.has(i.packing_list_id))) {
    const inv = l.invoice_item_id ? invoiceItemById.get(l.invoice_item_id) : undefined;
    const lineId = inv?.quotation_item_id ? orderLineOfQuoteLine.get(inv.quotation_item_id) : undefined;
    if (!lineId) {
      unmatched++;
      continue;
    }
    const t = packed.get(lineId) ?? { packages: 0, packageType: null, net: 0, gross: 0, cbm: 0 };
    packed.set(lineId, { packages: t.packages + Number(l.packages ?? 0), packageType: t.packageType ?? l.package_type, net: t.net + Number(l.net_weight ?? 0), gross: t.gross + Number(l.gross_weight ?? 0), cbm: t.cbm + Number(l.cbm ?? 0) });
  }
  for (const [lineId, t] of packed) {
    await tx.orderLine.update({ where: { id: lineId }, data: { packages: t.packages, packageType: t.packageType ?? "Carton", netWeightKg: t.net.toFixed(2), grossWeightKg: t.gross.toFixed(2), cbm: t.cbm.toFixed(3) } });
  }
  const plsOfOrder = groupBy(livePls, (p) => orderForInvoice(invoiceById.get(p.invoice_id)!));
  for (const [orderId, pls] of plsOfOrder) {
    const last = pls[pls.length - 1]!;
    await tx.order.update({ where: { id: orderId }, data: { packedAt: pls[0]!.created_at, containerNo: last.container_no?.slice(0, 120) ?? null, shippingMarks: last.marks } });
  }
  if (livePls.length) report.judge("Packing lists", `${livePls.length} packing lists → the packing list of their order (packages, weights and CBM added up per order line; container and marks from the latest)${unmatched ? `; ${unmatched} packing line(s) matched no order line and were left out` : ""}`);
  report.judge("Invoices", "old invoices are not copied: their numbers stay in the old app's database (kept at the switch-over); what was paid comes in as payments, and the new documents are made from each order");

  /* ---- payments in, per order: deposit first, then balance */
  const paymentsOfOrder = groupBy(
    old.payments.map((p) => ({ p, inv: invoiceById.get(p.invoice_id)! })),
    ({ inv }) => orderForInvoice(inv),
  );
  const paymentRows: Prisma.PaymentCreateManyInput[] = [];
  for (const [orderId, list] of paymentsOfOrder) {
    const o = [...orderOfInquiry.values()].find((x) => x.id === orderId)!;
    list
      .sort((a, b) => (a.p.paid_at < b.p.paid_at ? -1 : a.p.paid_at > b.p.paid_at ? 1 : a.p.created_at.getTime() - b.p.created_at.getTime()))
      .forEach(({ p, inv }, i) =>
        paymentRows.push({
          id: p.id,
          kind: map.paymentKind(i),
          orderId,
          customerId: o.customerId,
          amount: p.amount,
          currency: inv.currency,
          paidOn: toDbDate(p.paid_at),
          method: map.mapPaymentMethod(p.method),
          reference: p.reference,
          note: `Paid against invoice ${inv.invoice_no} (old app).`,
          recordedById: p.recorded_by,
          createdAt: p.created_at,
        }),
      );
  }
  await tx.payment.createMany({ data: paymentRows });
  report.judge("Payments", 'customer payments → payments "in" on the order, oldest first: the first is "deposit" (even when it paid everything), later ones "balance"; the invoice they were recorded against is kept in the note; bank charges 0');

  /* ---- audit log: copied as is, plus a record of the import */
  await tx.auditLog.createMany({
    data: old.auditLogs.map((a) => ({
      id: a.id,
      userId: a.user_id,
      action: a.action,
      entityType: a.entity_type,
      entityId: a.entity_id,
      summary: a.summary,
      oldValues: json(a.old_values),
      newValues: json(a.new_values),
      createdAt: a.created_at,
    })),
  });
  const importAudit: Prisma.AuditLogCreateManyInput[] = renumbered.map((r) => ({
    action: "legacy_import",
    entityType: "quotation_revision",
    entityId: r.revisionId,
    summary: `Imported from the old app's ${r.ref} (version ${r.version}); now ${r.parent} R${r.version}`,
    newValues: { legacyRefNo: r.ref },
  }));
  importAudit.push({ action: "legacy_import", entityType: "system", summary: `Imported the old app's data: ${old.queries.length} inquiries, ${ordered.length} orders, ${old.invoices.length} invoices, ${old.payments.length} payments` });
  await tx.auditLog.createMany({ data: importAudit });

  /* ---- counters: new numbers continue after the imported ones */
  const legacyCounters = Object.fromEntries(old.counters.map((c) => [c.key, c.value]));
  const counters = map.counterValues(
    [...old.queries.map((q) => q.ref_no), ...old.quotations.map((q) => q.ref_no)],
    legacyCounters,
    ["inquiry", "quotation"],
  );
  for (const [key, value] of counters) {
    await tx.counter.upsert({ where: { key }, update: { value }, create: { key, value } });
  }
  const unused = old.counters.filter((c) => !counters.has(c.key));
  if (unused.length) report.judge("Old counters not carried over", unused.map((c) => `${c.key}=${c.value} (no new document uses that prefix: an order's documents take its number)`).join(", "));

  /* ---- report: counts and totals */
  const c = {
    users: await tx.user.count(),
    customers: await tx.customer.count(),
    contacts: await tx.contact.count(),
    factories: await tx.factory.count(),
    inquiries: await tx.inquiry.count(),
    requestedItems: await tx.requestedItem.count(),
    stageChanges: await tx.inquiryStageChange.count(),
    assignments: await tx.inquiryAssignment.count(),
    notes: await tx.inquiryNote.count(),
    attachments: await tx.attachment.count(),
    factoryQuotes: await tx.factoryQuote.count(),
    factoryQuoteLines: await tx.factoryQuoteLine.count(),
    quotations: await tx.quotation.count(),
    revisions: await tx.quotationRevision.count(),
    quoteLines: await tx.quoteLine.count(),
    orders: await tx.order.count(),
    orderLines: await tx.orderLine.count(),
    orderStageChanges: await tx.orderStageChange.count(),
    payments: await tx.payment.count(),
    packedOrders: await tx.order.count({ where: { packedAt: { not: null } } }),
    audit: await tx.auditLog.count(),
    settings: await tx.setting.count(),
    counters: await tx.counter.findMany({ orderBy: { key: "asc" } }),
  };
  const stagesNew = await tx.inquiry.groupBy({ by: ["stage"], _count: true });
  const revStatuses = await tx.quotationRevision.groupBy({ by: ["status"], _count: true });
  const fmtGroup = (g: { _count: number }[], k: (x: never) => string) => g.map((x) => `${k(x as never)} ${x._count}`).join(", ");
  report.counts.push(
    { what: "users → users", old: old.users.length, new: c.users },
    { what: "customers → customers", old: old.customers.length, new: c.customers },
    { what: "customers → contacts (primary)", old: old.customers.length, new: c.contacts },
    { what: "suppliers → factories", old: old.suppliers.length, new: c.factories },
    { what: "queries → inquiries", old: old.queries.length, new: `${c.inquiries} (${fmtGroup(stagesNew, (x: { stage: string }) => x.stage)})` },
    { what: "query_items → requested_items", old: old.queryItems.length, new: c.requestedItems },
    { what: "query_status_history → inquiry_stage_changes", old: old.history.length, new: c.stageChanges },
    { what: "query_assignments → inquiry_assignments", old: old.assignments.length, new: c.assignments },
    { what: "comments → inquiry_notes", old: old.comments.length, new: c.notes },
    { what: "attachments → attachments", old: old.attachments.length, new: c.attachments },
    { what: "supplier_quotes → factory_quotes", old: old.supplierQuotes.length, new: c.factoryQuotes },
    { what: "supplier_quote_items → factory_quote_lines", old: old.supplierQuoteItems.length, new: c.factoryQuoteLines },
    { what: "quotations → quotations (one per inquiry)", old: old.quotations.length, new: c.quotations },
    { what: "quotations → quotation_revisions", old: old.quotations.length, new: `${c.revisions} (${fmtGroup(revStatuses, (x: { status: string }) => x.status)})` },
    { what: "quotation_items → quote_lines", old: old.quotationItems.length, new: c.quoteLines },
    { what: "accepted quotations → orders", old: old.quotations.filter((q) => q.status === "accepted" && !q.deleted_at).length, new: c.orders },
    { what: "  → order_lines", old: "-", new: c.orderLines },
    { what: "  → order stage history", old: "-", new: `${c.orderStageChanges}` },
    { what: "payments → payments (in)", old: old.payments.length, new: c.payments },
    { what: "packing_lists → orders with a packing list", old: old.packingLists.filter((p) => !p.deleted_at).length, new: c.packedOrders },
    { what: "audit_logs → audit_logs (+ import entries)", old: old.auditLogs.length, new: c.audit },
    { what: "settings (one JSON) → settings groups", old: old.settings.length, new: c.settings },
    { what: "counters → counters", old: old.counters.length, new: c.counters.map((x) => `${x.key}=${x.value}`).join(", ") },
    { what: "sessions (skipped: sign in again)", old: Number(old.skipped.sessions), new: 0 },
    { what: "notifications (skipped)", old: Number(old.skipped.notifications), new: 0 },
    { what: "device_tokens (skipped: phones sign in again)", old: Number(old.skipped.device_tokens), new: 0 },
  );

  const newPay = await tx.payment.findMany({ select: { amount: true } });
  const newRev = await tx.quotationRevision.findMany({ select: { total: true } });
  const newOrders = await tx.order.findMany({ select: { total: true } });
  const check = (what: string, oldMinor: number, newMinor: number) =>
    report.totals.push({ what, old: fromMinor(oldMinor), new: fromMinor(newMinor), ok: oldMinor === newMinor });
  check("payments", sumMinor(old.payments.map((p) => p.amount)), sumMinor(newPay.map((p) => p.amount)));
  check("old invoices' amount_paid vs new payments", sumMinor(old.invoices.map((i) => i.amount_paid)), sumMinor(newPay.map((p) => p.amount)));
  check("quotation totals (all versions)", sumMinor(old.quotations.map((q) => q.total)), sumMinor(newRev.map((r) => r.total)));
  check("order totals vs accepted quotations", sumMinor(ordered.map((d) => d.accepted!.total)), sumMinor(newOrders.map((o) => o.total)));
}

/* ---------------------------------------------------------------- main */

class DryRunRollback extends Error {}

async function main() {
  const { from, dryRun } = parseArgs(process.argv.slice(2));
  const target = process.env.DATABASE_URL;
  if (!from) throw new Error("Usage: tsx scripts/import-legacy.ts --from <old DATABASE_URL> [--dry-run]   (the new database comes from DATABASE_URL)");
  if (!target) throw new Error("DATABASE_URL (the new database) is not set");
  if (new URL(from).pathname === new URL(target).pathname && new URL(from).host === new URL(target).host) throw new Error("--from and DATABASE_URL point at the same database");

  const log = (s: string) => console.log(s);
  log(`[import] reading the old database ${new URL(from).host}${new URL(from).pathname}`);
  const old = await readLegacy(from);

  const prisma = createPrismaClient({ url: target, poolSize: 2 });
  const report = new Report();
  try {
    const inquiries = await prisma.inquiry.count();
    if (inquiries > 0) throw new Error(`The new database already has ${inquiries} inquiries: the import only runs into an empty database.`);
    const taken = await prisma.user.findMany({ where: { email: { in: old.users.map((u) => u.email) } }, select: { email: true } });
    if (taken.length) throw new Error(`These users already exist in the new database: ${taken.map((u) => u.email).join(", ")}. Import into a freshly migrated database (do not run the seed first).`);

    log(`[import] writing to ${new URL(target).host}${new URL(target).pathname}${dryRun ? " (dry run: rolled back at the end)" : ""}`);
    try {
      await prisma.$transaction(
        async (tx) => {
          await importAll(tx, old, report);
          const bad = report.totals.filter((t) => !t.ok && !t.what.startsWith("old invoices'"));
          if (bad.length) throw new Error(`Totals do not match (${bad.map((b) => b.what).join(", ")}): nothing was written.`);
          if (dryRun) throw new DryRunRollback();
        },
        { timeout: 10 * 60_000, maxWait: 60_000 },
      );
    } catch (e) {
      if (!(e instanceof DryRunRollback)) {
        if (report.counts.length) report.print(log);
        throw e;
      }
    }
    report.print(log);
    log(dryRun ? "\n[import] dry run finished: nothing was written." : "\n[import] done: everything above is in the new database.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[import] failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
