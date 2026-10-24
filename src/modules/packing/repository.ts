import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, invoices, packingListItems, packingLists, queries, users } from "@/lib/db/schema";

export async function getPackingListDetail(id: string) {
  const [row] = await db
    .select({ packingList: packingLists, invoice: invoices, query: queries, customer: customers, creatorName: users.name })
    .from(packingLists)
    .innerJoin(invoices, eq(invoices.id, packingLists.invoiceId))
    .innerJoin(queries, eq(queries.id, packingLists.queryId))
    .innerJoin(customers, eq(customers.id, packingLists.customerId))
    .innerJoin(users, eq(users.id, packingLists.createdBy))
    .where(and(eq(packingLists.id, id), isNull(packingLists.deletedAt)))
    .limit(1);
  if (!row) return null;
  const items = await db.select().from(packingListItems).where(eq(packingListItems.packingListId, id)).orderBy(asc(packingListItems.sortOrder));
  return { ...row, items };
}

/** Packing lists of one inquiry, with their totals, newest first. */
export async function listPackingListsForQuery(queryId: string) {
  return db
    .select({
      id: packingLists.id,
      plNo: packingLists.plNo,
      packDate: packingLists.packDate,
      invoiceId: packingLists.invoiceId,
      invoiceNo: invoices.invoiceNo,
      packages: sql<number>`(select coalesce(sum(i.packages), 0) from packing_list_items i where i.packing_list_id = "packing_lists"."id")`.mapWith(Number),
      grossWeight: sql<string>`(select coalesce(sum(i.gross_weight), 0) from packing_list_items i where i.packing_list_id = "packing_lists"."id")`,
      cbm: sql<string>`(select coalesce(sum(i.cbm), 0) from packing_list_items i where i.packing_list_id = "packing_lists"."id")`,
    })
    .from(packingLists)
    .innerJoin(invoices, eq(invoices.id, packingLists.invoiceId))
    .where(and(eq(packingLists.queryId, queryId), isNull(packingLists.deletedAt)))
    .orderBy(desc(packingLists.createdAt));
}
