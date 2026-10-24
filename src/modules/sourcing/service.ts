import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/db";
import { queryItems, supplierQuoteItems, supplierQuotes, suppliers } from "@/lib/db/schema";
import { assertCan, type SessionUser } from "@/lib/auth/session";
import { DomainError, ForbiddenError, NotFoundError } from "@/lib/utils/result";
import { diff, recordAudit } from "@/modules/audit/service";
import { canWorkOn, getAccessibleQuery } from "@/modules/queries/service";
import type { OfferInput, OfferLineInput, SupplierInput } from "./schema";

const supplierRow = (i: SupplierInput) => ({
  name: i.name,
  contactPerson: i.contactPerson ?? null,
  phone: i.phone ?? null,
  wechat: i.wechat ?? null,
  email: i.email ?? null,
  address: i.address ?? null,
  defaultVatRate: String(i.defaultVatRate),
  bankDetails: i.bankDetails ?? null,
  notes: i.notes ?? null,
});

/* ---------------------------------------------------------------- factories */

export async function createSupplier(actor: SessionUser, input: SupplierInput, tx?: DbOrTx) {
  assertCan(actor, "sourcing.manage");
  const run = async (t: DbOrTx) => {
    const [row] = await t
      .insert(suppliers)
      .values({ ...supplierRow(input), createdBy: actor.id })
      .returning({ id: suppliers.id });
    await recordAudit(t, { userId: actor.id, action: "create", entityType: "supplier", entityId: row.id, summary: `Added factory ${input.name}` });
    return row;
  };
  return tx ? run(tx) : db.transaction(run);
}

export async function updateSupplier(actor: SessionUser, id: string, input: SupplierInput) {
  assertCan(actor, "sourcing.manage");
  const [existing] = await db.select().from(suppliers).where(and(eq(suppliers.id, id), isNull(suppliers.deletedAt))).limit(1);
  if (!existing) throw new NotFoundError("Factory");
  const row = supplierRow(input);
  const changes = diff(existing, row);
  if (!changes.changed) return;
  await db.transaction(async (tx) => {
    await tx.update(suppliers).set(row).where(eq(suppliers.id, id));
    await recordAudit(tx, { userId: actor.id, action: "update", entityType: "supplier", entityId: id, summary: `Edited factory ${input.name}`, ...changes });
  });
}

/** Removed from lists and pickers; its past offers stay on their inquiries. */
export async function deleteSupplier(actor: SessionUser, id: string) {
  assertCan(actor, "sourcing.manage");
  if (actor.role === "staff") throw new ForbiddenError("Only a manager can remove a factory.");
  const [existing] = await db.select().from(suppliers).where(and(eq(suppliers.id, id), isNull(suppliers.deletedAt))).limit(1);
  if (!existing) throw new NotFoundError("Factory");
  await db.transaction(async (tx) => {
    await tx.update(suppliers).set({ deletedAt: new Date() }).where(eq(suppliers.id, id));
    await recordAudit(tx, { userId: actor.id, action: "delete", entityType: "supplier", entityId: id, summary: `Removed factory ${existing.name}` });
  });
}

/* ---------------------------------------------------------------- offers */

async function assertSourcing(actor: SessionUser, queryId: string) {
  assertCan(actor, "sourcing.manage");
  const query = await getAccessibleQuery(actor, queryId);
  if (!canWorkOn(actor, query)) throw new ForbiddenError("Only the person handling this inquiry or a manager can record factory offers.");
  return query;
}

/** Keep each line's id (quotations and choices point at them); add new ones, remove the ones taken out. */
async function writeOfferLines(tx: DbOrTx, offerId: string, queryId: string, lines: OfferLineInput[]) {
  const ownItems = new Set((await tx.select({ id: queryItems.id }).from(queryItems).where(eq(queryItems.queryId, queryId))).map((r) => r.id));
  const existing = new Set((await tx.select({ id: supplierQuoteItems.id }).from(supplierQuoteItems).where(eq(supplierQuoteItems.supplierQuoteId, offerId))).map((r) => r.id));
  const keep = lines.map((l) => l.id).filter((id): id is string => !!id && existing.has(id));
  await tx
    .delete(supplierQuoteItems)
    .where(keep.length ? and(eq(supplierQuoteItems.supplierQuoteId, offerId), notInArray(supplierQuoteItems.id, keep)) : eq(supplierQuoteItems.supplierQuoteId, offerId));
  for (const [i, l] of lines.entries()) {
    const row = {
      queryItemId: l.sourceId && ownItems.has(l.sourceId) ? l.sourceId : null,
      description: l.description,
      model: l.model ?? null,
      quantity: String(l.quantity),
      unit: l.unit,
      unitPrice: String(l.unitPrice),
      vatRate: String(l.vatRate),
      sortOrder: i,
    };
    if (l.id && existing.has(l.id)) await tx.update(supplierQuoteItems).set(row).where(eq(supplierQuoteItems.id, l.id));
    else await tx.insert(supplierQuoteItems).values({ ...row, supplierQuoteId: offerId });
  }
}

const offerRow = (input: OfferInput) => ({
  reference: input.reference ?? null,
  quotedOn: input.quotedOn,
  validUntil: input.validUntil ?? null,
  currency: input.currency,
  pricesIncludeVat: input.pricesIncludeVat,
  priceBasis: input.priceBasis ?? null,
  leadTime: input.leadTime ?? null,
  paymentTerms: input.paymentTerms ?? null,
  notes: input.notes ?? null,
});

async function supplierFor(actor: SessionUser, tx: DbOrTx, input: OfferInput): Promise<{ id: string; name: string }> {
  if (input.supplierId) {
    const [s] = await tx.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(and(eq(suppliers.id, input.supplierId), isNull(suppliers.deletedAt))).limit(1);
    if (!s) throw new DomainError("That factory no longer exists. Choose another one.");
    return s;
  }
  const name = input.newSupplierName!;
  const created = await createSupplier(actor, { name, defaultVatRate: input.items[0]?.vatRate ?? 13 }, tx);
  return { id: created.id, name };
}

export async function createOffer(actor: SessionUser, queryId: string, input: OfferInput) {
  const query = await assertSourcing(actor, queryId);
  return db.transaction(async (tx) => {
    const supplier = await supplierFor(actor, tx, input);
    const [offer] = await tx
      .insert(supplierQuotes)
      .values({ ...offerRow(input), queryId, supplierId: supplier.id, createdBy: actor.id })
      .returning({ id: supplierQuotes.id });
    await writeOfferLines(tx, offer.id, queryId, input.items);
    // The first offer for an item is chosen until someone picks another.
    await tx.execute(
      sql`update query_items qi set chosen_offer_item_id = l.id
            from supplier_quote_items l
           where l.supplier_quote_id = ${offer.id} and l.query_item_id = qi.id and qi.chosen_offer_item_id is null`,
    );
    await recordAudit(tx, { userId: actor.id, action: "create", entityType: "supplier_quote", entityId: offer.id, summary: `${query.refNo}: offer from ${supplier.name} (${input.items.length} lines, ${input.currency})` });
    return offer;
  });
}

export async function updateOffer(actor: SessionUser, offerId: string, input: OfferInput) {
  const [existing] = await db.select().from(supplierQuotes).where(and(eq(supplierQuotes.id, offerId), isNull(supplierQuotes.deletedAt))).limit(1);
  if (!existing) throw new NotFoundError("Factory offer");
  const query = await assertSourcing(actor, existing.queryId);
  await db.transaction(async (tx) => {
    const supplier = await supplierFor(actor, tx, input);
    await tx
      .update(supplierQuotes)
      .set({ ...offerRow(input), supplierId: supplier.id, updatedAt: new Date() })
      .where(eq(supplierQuotes.id, offerId));
    await writeOfferLines(tx, offerId, existing.queryId, input.items);
    await recordAudit(tx, { userId: actor.id, action: "update", entityType: "supplier_quote", entityId: offerId, summary: `${query.refNo}: edited the offer from ${supplier.name}` });
  });
}

/** Removed from the inquiry; items that had chosen one of its lines are left unchosen. */
export async function deleteOffer(actor: SessionUser, offerId: string) {
  const [existing] = await db.select().from(supplierQuotes).where(and(eq(supplierQuotes.id, offerId), isNull(supplierQuotes.deletedAt))).limit(1);
  if (!existing) throw new NotFoundError("Factory offer");
  const query = await assertSourcing(actor, existing.queryId);
  await db.transaction(async (tx) => {
    const lineIds = (await tx.select({ id: supplierQuoteItems.id }).from(supplierQuoteItems).where(eq(supplierQuoteItems.supplierQuoteId, offerId))).map((r) => r.id);
    if (lineIds.length) await tx.update(queryItems).set({ chosenOfferItemId: null }).where(inArray(queryItems.chosenOfferItemId, lineIds));
    await tx.update(supplierQuotes).set({ deletedAt: new Date() }).where(eq(supplierQuotes.id, offerId));
    await recordAudit(tx, { userId: actor.id, action: "delete", entityType: "supplier_quote", entityId: offerId, summary: `${query.refNo}: removed a factory offer` });
  });
  return existing.queryId;
}

/** Which factory line each requested item is quoted from ("" / null = none). */
export async function chooseOffers(actor: SessionUser, queryId: string, choices: Record<string, string | null>) {
  const query = await assertSourcing(actor, queryId);
  const items = await db.select({ id: queryItems.id }).from(queryItems).where(eq(queryItems.queryId, queryId));
  const own = new Set(items.map((i) => i.id));
  const lineIds = Object.values(choices).filter((v): v is string => !!v);
  const validLines = new Set(
    lineIds.length
      ? (
          await db
            .select({ id: supplierQuoteItems.id })
            .from(supplierQuoteItems)
            .innerJoin(supplierQuotes, eq(supplierQuotes.id, supplierQuoteItems.supplierQuoteId))
            .where(and(inArray(supplierQuoteItems.id, lineIds), eq(supplierQuotes.queryId, queryId), isNull(supplierQuotes.deletedAt)))
        ).map((r) => r.id)
      : [],
  );
  await db.transaction(async (tx) => {
    for (const [itemId, lineId] of Object.entries(choices)) {
      if (!own.has(itemId)) continue;
      if (lineId && !validLines.has(lineId)) throw new DomainError("One of the chosen offers is not on this inquiry any more. Reload the page.");
      await tx.update(queryItems).set({ chosenOfferItemId: lineId || null }).where(eq(queryItems.id, itemId));
    }
    await recordAudit(tx, { userId: actor.id, action: "update", entityType: "query", entityId: queryId, summary: `${query.refNo}: chose the factory offers to quote from` });
  });
}
