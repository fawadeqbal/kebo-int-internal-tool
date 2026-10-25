import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { queries, queryItems, supplierQuoteItems, supplierQuotes, suppliers, users } from "@/lib/db/schema";
import { convert, fxRate, unitPriceWithVat, type Rates } from "@/lib/costing";

export async function listSuppliers({ q, page = 1, pageSize = 25 }: { q?: string; page?: number; pageSize?: number }) {
  const term = q?.trim() ? `%${q.trim()}%` : null;
  const where = and(
    isNull(suppliers.deletedAt),
    term ? or(ilike(suppliers.name, term), ilike(suppliers.contactPerson, term), ilike(suppliers.phone, term), ilike(suppliers.wechat, term)) : undefined,
  );
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: suppliers.id,
        name: suppliers.name,
        contactPerson: suppliers.contactPerson,
        phone: suppliers.phone,
        wechat: suppliers.wechat,
        defaultVatRate: suppliers.defaultVatRate,
        /** Inquiries this factory has a price on. */
        offers: sql<number>`(select count(distinct sq.query_id)::int from supplier_quotes sq where sq.supplier_id = ${suppliers.id} and sq.deleted_at is null)`,
        lastOfferOn: sql<string | null>`(select max(sq.quoted_on)::text from supplier_quotes sq where sq.supplier_id = ${suppliers.id} and sq.deleted_at is null)`,
      })
      .from(suppliers)
      .where(where)
      .orderBy(asc(suppliers.name))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(suppliers).where(where),
  ]);
  return { rows, total, page, pageSize };
}

/**
 * The factory search box: with nothing typed, the factories used most recently;
 * otherwise those whose name, email, phone or WeChat contains the text.
 */
export async function searchSuppliers(q: string, limit = 8) {
  const text = q.trim();
  const term = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const lastUsed = sql<string | null>`(select max(sq.updated_at) from supplier_quotes sq where sq.supplier_id = ${suppliers.id} and sq.deleted_at is null)`;
  return db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      contactPerson: suppliers.contactPerson,
      email: suppliers.email,
      phone: suppliers.phone,
      wechat: suppliers.wechat,
      address: suppliers.address,
      defaultVatRate: suppliers.defaultVatRate,
      pricesIncludeVat: suppliers.pricesIncludeVat,
    })
    .from(suppliers)
    .where(
      and(
        isNull(suppliers.deletedAt),
        text ? or(ilike(suppliers.name, term), ilike(suppliers.email, term), ilike(suppliers.phone, term), ilike(suppliers.wechat, term), ilike(suppliers.contactPerson, term)) : undefined,
      ),
    )
    .orderBy(text ? sql`position(lower(${text}) in lower(${suppliers.name})) = 1 desc` : sql`${lastUsed} desc nulls last`, asc(suppliers.name))
    .limit(limit);
}

export type FactoryOption = Awaited<ReturnType<typeof searchSuppliers>>[number];

/** Every factory for the offer form's picker (A–Z). */
export async function allSuppliers() {
  return db
    .select({ id: suppliers.id, name: suppliers.name, defaultVatRate: suppliers.defaultVatRate })
    .from(suppliers)
    .where(isNull(suppliers.deletedAt))
    .orderBy(asc(suppliers.name))
    .limit(1000);
}

export async function findSupplier(id: string) {
  const [row] = await db.select().from(suppliers).where(and(eq(suppliers.id, id), isNull(suppliers.deletedAt))).limit(1);
  return row ?? null;
}

/** What a factory has priced, newest first: per item, the inquiry it was for and the price. */
export async function offersOfSupplier(supplierId: string, limit = 100) {
  return db
    .select({
      id: supplierQuoteItems.id,
      quotedOn: supplierQuotes.quotedOn,
      currency: supplierQuotes.currency,
      leadTime: supplierQuotes.leadTime,
      pricesIncludeVat: supplierQuotes.pricesIncludeVat,
      queryId: queries.id,
      queryRef: queries.refNo,
      queryTitle: queries.title,
      description: supplierQuoteItems.description,
      quantity: supplierQuoteItems.quantity,
      unit: supplierQuoteItems.unit,
      unitPrice: supplierQuoteItems.unitPrice,
      vatRate: supplierQuoteItems.vatRate,
    })
    .from(supplierQuoteItems)
    .innerJoin(supplierQuotes, eq(supplierQuotes.id, supplierQuoteItems.supplierQuoteId))
    .innerJoin(queries, eq(queries.id, supplierQuotes.queryId))
    .where(and(eq(supplierQuotes.supplierId, supplierId), isNull(supplierQuotes.deletedAt), isNull(queries.deletedAt)))
    .orderBy(desc(supplierQuotes.quotedOn), desc(supplierQuotes.createdAt))
    .limit(limit);
}

export async function findOffer(id: string) {
  const [row] = await db
    .select({ offer: supplierQuotes, supplier: suppliers })
    .from(supplierQuotes)
    .innerJoin(suppliers, eq(suppliers.id, supplierQuotes.supplierId))
    .where(and(eq(supplierQuotes.id, id), isNull(supplierQuotes.deletedAt)))
    .limit(1);
  if (!row) return null;
  const items = await db.select().from(supplierQuoteItems).where(eq(supplierQuoteItems.supplierQuoteId, id)).orderBy(asc(supplierQuoteItems.sortOrder));
  return { ...row, items };
}

/**
 * Every factory offer on an inquiry, and per requested item the lines offered
 * for it with what one unit costs us in `currency` (VAT included), cheapest
 * first. `chosen` is the line picked for the quotation.
 */
export async function sourcingForQuery(queryId: string, currency: string, main: string, rates: Rates) {
  const offers = await db
    .select({
      id: supplierQuotes.id,
      supplierId: suppliers.id,
      supplierName: suppliers.name,
      supplierVatRate: suppliers.defaultVatRate,
      supplierPricesIncludeVat: suppliers.pricesIncludeVat,
      supplierEmail: suppliers.email,
      supplierPhone: suppliers.phone,
      reference: supplierQuotes.reference,
      quotedOn: supplierQuotes.quotedOn,
      validUntil: supplierQuotes.validUntil,
      currency: supplierQuotes.currency,
      pricesIncludeVat: supplierQuotes.pricesIncludeVat,
      priceBasis: supplierQuotes.priceBasis,
      leadTime: supplierQuotes.leadTime,
      paymentTerms: supplierQuotes.paymentTerms,
      notes: supplierQuotes.notes,
      createdByName: users.name,
    })
    .from(supplierQuotes)
    .innerJoin(suppliers, eq(suppliers.id, supplierQuotes.supplierId))
    .innerJoin(users, eq(users.id, supplierQuotes.createdBy))
    .where(and(eq(supplierQuotes.queryId, queryId), isNull(supplierQuotes.deletedAt)))
    .orderBy(asc(supplierQuotes.quotedOn), asc(supplierQuotes.createdAt));
  const [lines, items] = await Promise.all([
    offers.length
      ? db
          .select()
          .from(supplierQuoteItems)
          .where(
            inArray(
              supplierQuoteItems.supplierQuoteId,
              offers.map((o) => o.id),
            ),
          )
          .orderBy(asc(supplierQuoteItems.sortOrder))
      : Promise.resolve([]),
    db.select().from(queryItems).where(eq(queryItems.queryId, queryId)).orderBy(asc(queryItems.sortOrder)),
  ]);

  const costed = lines.map((l) => {
    const o = offers.find((x) => x.id === l.supplierQuoteId)!;
    const withVat = unitPriceWithVat(Number(l.unitPrice), Number(l.vatRate), o.pricesIncludeVat);
    const rate = fxRate(o.currency, currency, main, rates);
    return {
      ...l,
      offerId: o.id,
      supplierId: o.supplierId,
      supplierVatRate: o.supplierVatRate,
      supplierPricesIncludeVat: o.supplierPricesIncludeVat,
      supplierEmail: o.supplierEmail,
      supplierPhone: o.supplierPhone,
      pricesIncludeVat: o.pricesIncludeVat,
      supplierName: o.supplierName,
      offerCurrency: o.currency,
      leadTime: o.leadTime,
      /** One unit incl. VAT, in the factory's currency. */
      unitPriceWithVat: withVat,
      /** One unit incl. VAT, in the quotation currency (null when no exchange rate is set). */
      unitCost: rate ? convert(withVat, rate) : null,
      fxRate: rate,
    };
  });

  return {
    currency,
    offers: offers.map((o) => {
      const own = costed.filter((l) => l.offerId === o.id);
      const total = own.reduce((t, l) => t + Math.round(l.unitPriceWithVat * 100) * Number(l.quantity), 0);
      return { ...o, lines: own, totalWithVatCents: Math.round(total) };
    }),
    items: items.map((it) => {
      const options = costed.filter((l) => l.queryItemId === it.id).sort((a, b) => (a.unitCost ?? Infinity) - (b.unitCost ?? Infinity));
      return { ...it, options, chosen: options.find((o) => o.id === it.chosenOfferItemId) ?? null, cheapest: options[0] ?? null };
    }),
    missingRates: [...new Set(costed.filter((l) => l.fxRate === null).map((l) => l.offerCurrency))],
  };
}

export type Sourcing = Awaited<ReturnType<typeof sourcingForQuery>>;
