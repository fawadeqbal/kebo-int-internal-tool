import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { invoiceItems, invoices, payments, queries, quotationItems } from "@/lib/db/schema";
import { assertCan, type SessionUser } from "@/lib/auth/session";
import { nextReference } from "@/lib/counters";
import { calculateTotals, formatCents, fromCents, toCents } from "@/lib/utils/money";
import { DomainError, NotFoundError } from "@/lib/utils/result";
import { recordAudit } from "@/modules/audit/service";
import { publish } from "@/modules/events";
import { getAccessibleQuotation, latestVersion } from "@/modules/quotations/service";
import { getSettings } from "@/modules/settings/service";
import { companySnapshot, customerSnapshotFor } from "@/modules/documents/snapshots";
import type { InvoiceInput, PaymentInput } from "./schema";
import { paymentStatus } from "./status";

/** Generate an invoice from an accepted quotation. Once issued, the invoice is locked. */
export async function createInvoice(actor: SessionUser, quotationId: string, input: InvoiceInput) {
  assertCan(actor, "invoices.manage");
  const quotation = await getAccessibleQuotation(actor, quotationId);
  if (quotation.status !== "accepted") throw new DomainError("Only an accepted quotation can be invoiced.");
  if (quotation.version < (await latestVersion(quotation.queryId))) throw new DomainError("A newer version of this quotation exists: invoice that one.");
  const [existing] = await db
    .select({ invoiceNo: invoices.invoiceNo })
    .from(invoices)
    .where(and(eq(invoices.quotationId, quotationId), ne(invoices.status, "cancelled")))
    .limit(1);
  if (existing) throw new DomainError(`This quotation already has invoice ${existing.invoiceNo}.`);

  const t = calculateTotals(input.items, input.discount, input.taxRate);
  if (t.total <= 0) throw new DomainError("The invoice total must be more than zero.");
  const [query] = await db.select({ customerId: queries.customerId, refNo: queries.refNo }).from(queries).where(eq(queries.id, quotation.queryId));
  // Lines keep a link to the quotation line they were invoiced from (only this quotation's).
  const own = new Set((await db.select({ id: quotationItems.id }).from(quotationItems).where(eq(quotationItems.quotationId, quotationId))).map((r) => r.id));
  const settings = await getSettings();

  const created = await db.transaction(async (tx) => {
    const invoiceNo = await nextReference(tx, "INV", Number(input.issueDate.slice(0, 4)));
    const [inv] = await tx
      .insert(invoices)
      .values({
        invoiceNo,
        quotationId,
        queryId: quotation.queryId,
        customerId: query.customerId,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        currency: quotation.currency,
        subtotal: fromCents(t.subtotal),
        discount: fromCents(t.discount),
        taxRate: String(t.taxRate),
        taxAmount: fromCents(t.taxAmount),
        total: fromCents(t.total),
        amountPaid: "0",
        status: "unpaid",
        notes: input.notes ?? null,
        customerSnapshot: await customerSnapshotFor(tx, query.customerId),
        companySnapshot: companySnapshot(settings),
        createdBy: actor.id,
      })
      .returning({ id: invoices.id, invoiceNo: invoices.invoiceNo });
    await tx.insert(invoiceItems).values(
      input.items.map((item, i) => ({
        invoiceId: inv.id,
        quotationItemId: item.sourceId && own.has(item.sourceId) ? item.sourceId : null,
        description: item.description,
        model: item.model ?? null,
        hsCode: item.hsCode ?? null,
        quantity: String(item.quantity),
        unit: item.unit,
        unitPrice: String(item.unitPrice),
        lineTotal: fromCents(t.lines[i].lineTotal),
        sortOrder: i,
      })),
    );
    await recordAudit(tx, {
      userId: actor.id,
      action: "create",
      entityType: "invoice",
      entityId: inv.id,
      summary: `Issued invoice ${invoiceNo} for ${query.refNo} — total ${fromCents(t.total)}`,
    });
    return inv;
  });
  await publish({ type: "invoice.created", invoiceId: created.id, invoiceNo: created.invoiceNo, actorId: actor.id });
  return created;
}

export async function recordPayment(actor: SessionUser, invoiceId: string, input: PaymentInput) {
  assertCan(actor, "payments.record");
  const result = await db.transaction(async (tx) => {
    // Lock the invoice row so two people recording payments at once cannot overpay it.
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for("update");
    if (!inv) throw new NotFoundError("Invoice");
    if (inv.status === "cancelled") throw new DomainError("This invoice is cancelled.");
    if (inv.status === "paid") throw new DomainError("This invoice is already fully paid.");
    const currency = inv.currency;
    const outstanding = toCents(inv.total) - toCents(inv.amountPaid);
    const amount = toCents(input.amount);
    if (amount > outstanding) throw new DomainError(`The amount is more than the balance due (${formatCents(outstanding, currency)}).`);
    if (input.paidAt < inv.issueDate) throw new DomainError("The payment date cannot be before the invoice date.");

    const newPaid = fromCents(toCents(inv.amountPaid) + amount);
    const status = paymentStatus(inv.total, newPaid);
    await tx.insert(payments).values({
      invoiceId,
      amount: fromCents(amount),
      paidAt: input.paidAt,
      method: input.method,
      reference: input.reference ?? null,
      recordedBy: actor.id,
    });
    await tx.update(invoices).set({ amountPaid: newPaid, status }).where(eq(invoices.id, invoiceId));
    await recordAudit(tx, {
      userId: actor.id,
      action: "payment",
      entityType: "invoice",
      entityId: invoiceId,
      summary: `Recorded payment of ${fromCents(amount)} on ${inv.invoiceNo}`,
      oldValues: { amountPaid: inv.amountPaid, status: inv.status },
      newValues: { amountPaid: newPaid, status },
    });
    return { invoiceNo: inv.invoiceNo, amount: formatCents(amount, currency) };
  });
  await publish({ type: "payment.recorded", invoiceId, invoiceNo: result.invoiceNo, amount: result.amount, actorId: actor.id });
}

export async function cancelInvoice(actor: SessionUser, invoiceId: string, reason: string) {
  assertCan(actor, "invoices.manage");
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!inv) throw new NotFoundError("Invoice");
  if (inv.status === "cancelled") throw new DomainError("This invoice is already cancelled.");
  if (toCents(inv.amountPaid) > 0) throw new DomainError("Payments have been recorded on this invoice, so it cannot be cancelled.");
  await db.transaction(async (tx) => {
    await tx.update(invoices).set({ status: "cancelled", cancelReason: reason }).where(eq(invoices.id, invoiceId));
    await recordAudit(tx, {
      userId: actor.id,
      action: "cancel",
      entityType: "invoice",
      entityId: invoiceId,
      summary: `Cancelled invoice ${inv.invoiceNo}: ${reason}`,
    });
  });
}
