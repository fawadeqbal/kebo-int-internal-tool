import { and, count, eq, ilike, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/db";
import { queryItems, supplierQuoteItems, supplierQuotes, suppliers } from "@/lib/db/schema";
import { assertCan, type SessionUser } from "@/lib/auth/session";
import { DomainError, ForbiddenError, NotFoundError } from "@/lib/utils/result";
import { diff, recordAudit } from "@/modules/audit/service";
import { canWorkOn, getAccessibleQuery } from "@/modules/queries/service";
import type { ItemPriceInput, OfferInput, OfferLineInput, SupplierInput } from "./schema";
import { todayISO } from "@/lib/utils/dates";
import { getSettings } from "@/modules/settings/service";

const supplierRow = (i: SupplierInput) => ({
  name: i.name,
  contactPerson: i.contactPerson ?? null,
  phone: i.phone ?? null,
  wechat: i.wechat ?? null,
  email: i.email ?? null,
  address: i.address ?? null,
  defaultVatRate: String(i.defaultVatRate),
  ...(i.pricesIncludeVat === undefined ? {} : { pricesIncludeVat: i.pricesIncludeVat }),
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

/* ---------------------------------------------------------------- the simple way: one price per item */

type Factory = { id: string; name: string; defaultVatRate: string; pricesIncludeVat: boolean };
const factoryColumns = { id: suppliers.id, name: suppliers.name, email: suppliers.email, phone: suppliers.phone, defaultVatRate: suppliers.defaultVatRate, pricesIncludeVat: suppliers.pricesIncludeVat };

/**
 * The factory picked from the list, or for a typed name the factory with that name
 * (ignoring case) or a new one with the contacts and VAT given. A known factory only
 * gets the contacts it has none of.
 */
async function resolveFactory(actor: SessionUser, tx: DbOrTx, input: ItemPriceInput): Promise<Factory> {
  if (input.supplierId) {
    const [s] = await tx.select(factoryColumns).from(suppliers).where(and(eq(suppliers.id, input.supplierId), isNull(suppliers.deletedAt))).limit(1);
    if (!s) throw new DomainError("That factory was removed. Choose another one.");
    return s;
  }
  const clean = (input.factoryName ?? "").trim().replace(/\s+/g, " ");
  const [found] = await tx
    .select(factoryColumns)
    .from(suppliers)
    .where(and(isNull(suppliers.deletedAt), ilike(suppliers.name, clean.replace(/[\\%_]/g, (c) => `\\${c}`))))
    .limit(1);
  if (found) {
    const fill = { ...(!found.email && input.email ? { email: input.email } : {}), ...(!found.phone && input.phone ? { phone: input.phone } : {}) };
    if (Object.keys(fill).length) await tx.update(suppliers).set(fill).where(eq(suppliers.id, found.id));
    return found;
  }
  const vat = input.vatRate ?? 13;
  const incl = input.pricesIncludeVat ?? true;
  const created = await createSupplier(actor, { name: clean, defaultVatRate: vat, pricesIncludeVat: incl, email: input.email ?? null, phone: input.phone ?? null }, tx);
  return { id: created.id, name: clean, defaultVatRate: String(vat), pricesIncludeVat: incl };
}

/** Removes the item's current factory line; an offer made only for it goes too. */
async function dropChosenLine(tx: DbOrTx, item: { id: string; chosenOfferItemId: string | null }) {
  if (!item.chosenOfferItemId) return;
  const [line] = await tx.select({ id: supplierQuoteItems.id, offerId: supplierQuoteItems.supplierQuoteId }).from(supplierQuoteItems).where(eq(supplierQuoteItems.id, item.chosenOfferItemId)).limit(1);
  await tx.update(queryItems).set({ chosenOfferItemId: null }).where(eq(queryItems.id, item.id));
  if (!line) return;
  const [{ n }] = await tx.select({ n: count() }).from(supplierQuoteItems).where(eq(supplierQuoteItems.supplierQuoteId, line.offerId));
  if (n <= 1) {
    await tx.delete(supplierQuoteItems).where(eq(supplierQuoteItems.id, line.id));
    await tx.update(supplierQuotes).set({ deletedAt: new Date() }).where(eq(supplierQuotes.id, line.offerId));
  }
}

async function ownItem(queryId: string, itemId: string) {
  const [item] = await db.select().from(queryItems).where(and(eq(queryItems.id, itemId), eq(queryItems.queryId, queryId))).limit(1);
  if (!item) throw new NotFoundError("Item");
  return item;
}

/**
 * Which factory supplies this customer item, at what price and VAT. One price
 * per item: saving again replaces it. New quotations are priced from it.
 */
export async function setItemFactoryPrice(actor: SessionUser, queryId: string, itemId: string, input: ItemPriceInput) {
  const query = await assertSourcing(actor, queryId);
  const item = await ownItem(queryId, itemId);
  // Factory prices are in the main currency (USD), like everything else.
  const currency = (await getSettings()).currency;
  await db.transaction(async (tx) => {
    const factory = await resolveFactory(actor, tx, input);
    // VAT: the factory's, unless this item was given its own (e.g. 6% on a service).
    const vatRate = input.vatRate ?? Number(factory.defaultVatRate);
    const pricesIncludeVat = input.pricesIncludeVat ?? factory.pricesIncludeVat;
    const offerFields = {
      quotedOn: todayISO(),
      currency,
      pricesIncludeVat,
      leadTime: input.leadTime ?? null,
      supplierId: factory.id,
    };
    const lineFields = {
      queryItemId: item.id,
      description: item.description,
      model: item.model,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: String(input.unitPrice),
      vatRate: String(vatRate),
      sortOrder: 0,
    };
    // Same factory, and the offer holds only this item: update it in place (quotations keep pointing at it).
    const [current] = item.chosenOfferItemId
      ? await tx
          .select({ lineId: supplierQuoteItems.id, offerId: supplierQuotes.id, supplierId: supplierQuotes.supplierId })
          .from(supplierQuoteItems)
          .innerJoin(supplierQuotes, eq(supplierQuotes.id, supplierQuoteItems.supplierQuoteId))
          .where(and(eq(supplierQuoteItems.id, item.chosenOfferItemId), isNull(supplierQuotes.deletedAt)))
          .limit(1)
      : [];
    const alone = current ? (await tx.select({ n: count() }).from(supplierQuoteItems).where(eq(supplierQuoteItems.supplierQuoteId, current.offerId)))[0].n === 1 : false;
    if (current && alone) {
      await tx.update(supplierQuotes).set({ ...offerFields, updatedAt: new Date() }).where(eq(supplierQuotes.id, current.offerId));
      await tx.update(supplierQuoteItems).set(lineFields).where(eq(supplierQuoteItems.id, current.lineId));
    } else {
      await dropChosenLine(tx, item);
      const [offer] = await tx
        .insert(supplierQuotes)
        .values({ ...offerFields, queryId, createdBy: actor.id })
        .returning({ id: supplierQuotes.id });
      const [line] = await tx
        .insert(supplierQuoteItems)
        .values({ ...lineFields, supplierQuoteId: offer.id })
        .returning({ id: supplierQuoteItems.id });
      await tx.update(queryItems).set({ chosenOfferItemId: line.id }).where(eq(queryItems.id, item.id));
    }
    await recordAudit(tx, {
      userId: actor.id,
      action: "update",
      entityType: "query",
      entityId: queryId,
      summary: `${query.refNo}: factory price for "${item.description.split("\n")[0]}": ${factory.name}, ${currency} ${input.unitPrice} (${pricesIncludeVat ? "incl." : "+"} ${vatRate}% VAT)`,
    });
  });
}

/** The item has no factory price any more (it is priced by hand on the quotation). */
export async function clearItemFactoryPrice(actor: SessionUser, queryId: string, itemId: string) {
  const query = await assertSourcing(actor, queryId);
  const item = await ownItem(queryId, itemId);
  await db.transaction(async (tx) => {
    await dropChosenLine(tx, item);
    await recordAudit(tx, { userId: actor.id, action: "update", entityType: "query", entityId: queryId, summary: `${query.refNo}: removed the factory price for "${item.description.split("\n")[0]}"` });
  });
}

