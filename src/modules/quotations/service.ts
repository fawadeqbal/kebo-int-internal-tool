import { and, eq, isNull, max, ne } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/db";
import { invoices, queries, queryItems, quotationItems, quotations, supplierQuoteItems, supplierQuotes, type QuotationStatus } from "@/lib/db/schema";
import { assertCan, type SessionUser } from "@/lib/auth/session";
import { nextReference } from "@/lib/counters";
import { calculateTotals, fromCents } from "@/lib/utils/money";
import { todayISO } from "@/lib/utils/dates";
import { DomainError, NotFoundError } from "@/lib/utils/result";
import { QUOTATION_STATUS_LABEL } from "@/lib/labels";
import type { LineItem } from "@/lib/line-items";
import { recordAudit } from "@/modules/audit/service";
import { publish } from "@/modules/events";
import { getAccessibleQuery } from "@/modules/queries/service";
import { getSettings } from "@/modules/settings/service";
import { companySnapshot, customerSnapshotFor } from "@/modules/documents/snapshots";
import { vatForCustomer, type Vat } from "@/modules/documents/vat";
import type { QuotationInput } from "./schema";
import { canMoveQuotation, isEditable } from "./workflow";

/** The VAT typed on the quotation replaces the default rate (staff may change it for an order). */
const withRate = (vat: Vat, typed?: number): Vat => (typed === undefined ? vat : { ...vat, rate: typed });

function totalsFor(items: LineItem[], discount: number, vat: Vat) {
  const t = calculateTotals(items, discount, vat.rate, vat.included);
  return {
    t,
    columns: {
      subtotal: fromCents(t.subtotal),
      discount: fromCents(t.discount),
      taxRate: String(t.taxRate),
      pricesIncludeVat: t.pricesIncludeVat,
      taxAmount: fromCents(t.taxAmount),
      total: fromCents(t.total),
    },
    itemRows: items.map((item, i) => ({
      queryItemId: item.sourceId ?? null,
      supplierQuoteItemId: item.costSourceId ?? null,
      unitCost: item.unitCost === null || item.unitCost === undefined ? null : String(item.unitCost),
      fxRate: item.fxRate === null || item.fxRate === undefined ? null : String(item.fxRate),
      description: item.description,
      model: item.model ?? null,
      hsCode: item.hsCode ?? null,
      quantity: String(item.quantity),
      unit: item.unit,
      unitPrice: String(item.unitPrice),
      lineTotal: fromCents(t.lines[i].lineTotal),
      sortOrder: i,
    })),
  };
}

/** Keep only links to this inquiry's own requested items and factory offer lines. */
async function ownItemLinks<T extends { queryItemId: string | null; supplierQuoteItemId: string | null }>(tx: DbOrTx, queryId: string, rows: T[]): Promise<T[]> {
  const own = new Set((await tx.select({ id: queryItems.id }).from(queryItems).where(eq(queryItems.queryId, queryId))).map((r) => r.id));
  const offerLines = new Set(
    (
      await tx
        .select({ id: supplierQuoteItems.id })
        .from(supplierQuoteItems)
        .innerJoin(supplierQuotes, eq(supplierQuotes.id, supplierQuoteItems.supplierQuoteId))
        .where(eq(supplierQuotes.queryId, queryId))
    ).map((r) => r.id),
  );
  return rows.map((r) => ({
    ...r,
    queryItemId: r.queryItemId && own.has(r.queryItemId) ? r.queryItemId : null,
    supplierQuoteItemId: r.supplierQuoteItemId && offerLines.has(r.supplierQuoteItemId) ? r.supplierQuoteItemId : null,
  }));
}

/** The newest version number of an inquiry's quotations. Older versions are superseded. */
export async function latestVersion(queryId: string, tx: DbOrTx = db): Promise<number> {
  const [{ v }] = await tx.select({ v: max(quotations.version) }).from(quotations).where(and(eq(quotations.queryId, queryId), isNull(quotations.deletedAt)));
  return v ?? 0;
}

async function assertLatest(q: { queryId: string; version: number }, what: string) {
  if (q.version < (await latestVersion(q.queryId))) throw new DomainError(`A newer version of this quotation exists, so this one cannot be ${what}. Open the latest version.`);
}

export async function getAccessibleQuotation(user: SessionUser, id: string) {
  const [row] = await db.select().from(quotations).where(and(eq(quotations.id, id), isNull(quotations.deletedAt))).limit(1);
  if (!row) throw new NotFoundError("Quotation");
  await getAccessibleQuery(user, row.queryId);
  return row;
}

export async function createQuotation(actor: SessionUser, queryId: string, input: QuotationInput) {
  assertCan(actor, "quotations.manage");
  const query = await getAccessibleQuery(actor, queryId);
  if (query.status === "not_completed") throw new DomainError("This inquiry is closed as not completed. Reopen it before quoting.");
  // VAT: the rate typed on the quotation, or the super admin's setting (none for a VAT-exempt customer);
  // whether prices include it is always the setting.
  const { t, columns, itemRows } = totalsFor(input.items, input.discount, withRate(await vatForCustomer(query.customerId), input.taxRate));
  if (t.total <= 0) throw new DomainError("The quotation total must be more than zero.");
  const currency = (await getSettings()).currency;

  return db.transaction(async (tx) => {
    const [{ v }] = await tx.select({ v: max(quotations.version) }).from(quotations).where(eq(quotations.queryId, queryId));
    const version = (v ?? 0) + 1;
    const refNo = await nextReference(tx, "QUO");
    const [created] = await tx
      .insert(quotations)
      .values({
        refNo,
        queryId,
        version,
        currency,
        ...columns,
        dueDate: input.dueDate,
        submittedAt: input.submittedAt ?? null,
        terms: input.terms ?? null,
        notes: input.notes ?? null,
        createdBy: actor.id,
        status: "draft",
      })
      .returning({ id: quotations.id, refNo: quotations.refNo });
    await tx.insert(quotationItems).values((await ownItemLinks(tx, queryId, itemRows)).map((r) => ({ ...r, quotationId: created.id })));
    await recordAudit(tx, {
      userId: actor.id,
      action: "create",
      entityType: "quotation",
      entityId: created.id,
      summary: `Created quotation ${refNo} v${version} for ${query.refNo} — total ${columns.total}`,
      newValues: columns,
    });
    return created;
  });
}

export async function updateQuotation(actor: SessionUser, id: string, input: QuotationInput) {
  assertCan(actor, "quotations.manage");
  const existing = await getAccessibleQuotation(actor, id);
  if (!isEditable(existing.status)) throw new DomainError("Only draft quotations can be edited. Create a new version instead.");
  await assertLatest(existing, "edited");
  const [{ customerId }] = await db.select({ customerId: queries.customerId }).from(queries).where(eq(queries.id, existing.queryId));
  const { t, columns, itemRows } = totalsFor(input.items, input.discount, withRate(await vatForCustomer(customerId), input.taxRate));
  if (t.total <= 0) throw new DomainError("The quotation total must be more than zero.");
  await db.transaction(async (tx) => {
    await tx
      .update(quotations)
      .set({ ...columns, dueDate: input.dueDate, submittedAt: input.submittedAt ?? null, terms: input.terms ?? null, notes: input.notes ?? null })
      .where(eq(quotations.id, id));
    await tx.delete(quotationItems).where(eq(quotationItems.quotationId, id));
    await tx.insert(quotationItems).values((await ownItemLinks(tx, existing.queryId, itemRows)).map((r) => ({ ...r, quotationId: id })));
    await recordAudit(tx, {
      userId: actor.id,
      action: "update",
      entityType: "quotation",
      entityId: id,
      summary: `Edited quotation ${existing.refNo}`,
      oldValues: { subtotal: existing.subtotal, discount: existing.discount, taxRate: existing.taxRate, total: existing.total, dueDate: existing.dueDate },
      newValues: { ...columns, dueDate: input.dueDate },
    });
  });
}

export async function changeQuotationStatus(actor: SessionUser, id: string, to: QuotationStatus, submittedAt?: string) {
  assertCan(actor, "quotations.manage");
  const existing = await getAccessibleQuotation(actor, id);
  if (!canMoveQuotation(existing.status, to))
    throw new DomainError(`A ${QUOTATION_STATUS_LABEL[existing.status].toLowerCase()} quotation cannot be marked ${QUOTATION_STATUS_LABEL[to].toLowerCase()}.`);
  await assertLatest(existing, `marked ${QUOTATION_STATUS_LABEL[to].toLowerCase()}`);
  const settings = to === "sent" ? await getSettings() : null;
  await db.transaction(async (tx) => {
    // Sending freezes who it was for and who sent it (and in which currency), as on the PDF.
    // The VAT is the quotation's own (as saved).
    let frozen = {};
    if (to === "sent") {
      const customerId = (await tx.select({ c: queries.customerId }).from(queries).where(eq(queries.id, existing.queryId)))[0].c;
      frozen = {
        submittedAt: submittedAt || existing.submittedAt || todayISO(),
        customerSnapshot: await customerSnapshotFor(tx, customerId),
        companySnapshot: companySnapshot(settings!),
      };
    }
    await tx.update(quotations).set({ status: to, ...frozen }).where(eq(quotations.id, id));
    await recordAudit(tx, {
      userId: actor.id,
      action: "status_change",
      entityType: "quotation",
      entityId: id,
      summary: `${existing.refNo}: ${QUOTATION_STATUS_LABEL[existing.status]} → ${QUOTATION_STATUS_LABEL[to]}`,
      oldValues: { status: existing.status },
      newValues: { status: to },
    });
  });
  const query = await getAccessibleQuery(actor, existing.queryId);
  await publish({
    type: "quotation.statusChanged",
    quotationId: id,
    refNo: existing.refNo,
    status: to,
    actorId: actor.id,
    notify: [existing.createdBy, query.assignedTo].filter((v): v is string => !!v),
  });
}

/** A changed price after sending = a new version, so what the customer saw is never altered. */
export async function reviseQuotation(actor: SessionUser, id: string) {
  assertCan(actor, "quotations.manage");
  const existing = await getAccessibleQuotation(actor, id);
  await assertLatest(existing, "revised");
  if (existing.status === "draft") throw new DomainError("This version is still a draft: edit it instead of making a new version.");
  const [invoiced] = await db
    .select({ invoiceNo: invoices.invoiceNo })
    .from(invoices)
    .where(and(eq(invoices.quotationId, id), ne(invoices.status, "cancelled")))
    .limit(1);
  if (invoiced) throw new DomainError(`This quotation is already invoiced (${invoiced.invoiceNo}). Cancel the invoice first to change the prices.`);
  const items = await db.select().from(quotationItems).where(eq(quotationItems.quotationId, id)).orderBy(quotationItems.sortOrder);
  return createQuotation(actor, existing.queryId, {
    items: items.map((i) => ({
      sourceId: i.queryItemId,
      description: i.description,
      model: i.model,
      hsCode: i.hsCode,
      quantity: Number(i.quantity),
      unit: i.unit,
      unitPrice: Number(i.unitPrice),
      unitCost: i.unitCost === null ? null : Number(i.unitCost),
      costSourceId: i.supplierQuoteItemId,
      fxRate: i.fxRate === null ? null : Number(i.fxRate),
    })),
    discount: Number(existing.discount),
    taxRate: Number(existing.taxRate),
    dueDate: existing.dueDate < todayISO() ? todayISO() : existing.dueDate,
    submittedAt: null,
    terms: existing.terms,
    notes: existing.notes,
  });
}

export async function deleteDraftQuotation(actor: SessionUser, id: string) {
  assertCan(actor, "quotations.manage");
  const existing = await getAccessibleQuotation(actor, id);
  if (existing.status !== "draft") throw new DomainError("Only drafts can be deleted.");
  const [inv] = await db.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.quotationId, id), ne(invoices.status, "cancelled"))).limit(1);
  if (inv) throw new DomainError("This quotation has an invoice.");
  await db.transaction(async (tx) => {
    await tx.update(quotations).set({ deletedAt: new Date() }).where(eq(quotations.id, id));
    await recordAudit(tx, { userId: actor.id, action: "delete", entityType: "quotation", entityId: id, summary: `Deleted draft ${existing.refNo}` });
  });
  return existing.queryId;
}
