import { and, eq, isNull } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/db";
import { invoices, packingListItems, packingLists } from "@/lib/db/schema";
import { assertCan, type SessionUser } from "@/lib/auth/session";
import { nextReference } from "@/lib/counters";
import { packingTotals } from "@/lib/packing";
import { DomainError, NotFoundError } from "@/lib/utils/result";
import { recordAudit } from "@/modules/audit/service";
import type { PackingListInput } from "./schema";

const header = (input: PackingListInput) => ({
  packDate: input.packDate,
  incoterm: input.incoterm ?? null,
  portOfLoading: input.portOfLoading ?? null,
  portOfDischarge: input.portOfDischarge ?? null,
  finalDestination: input.finalDestination ?? null,
  transport: input.transport ?? null,
  containerNo: input.containerNo ?? null,
  sealNo: input.sealNo ?? null,
  marks: input.marks ?? null,
  notes: input.notes ?? null,
});

async function writeLines(tx: DbOrTx, packingListId: string, input: PackingListInput) {
  await tx.delete(packingListItems).where(eq(packingListItems.packingListId, packingListId));
  await tx.insert(packingListItems).values(
    input.items.map((l, i) => ({
      packingListId,
      description: l.description,
      quantity: String(l.quantity),
      unit: l.unit,
      packages: l.packages,
      packageType: l.packageType,
      netWeight: String(l.netWeight),
      grossWeight: String(l.grossWeight),
      cbm: String(l.cbm),
      sortOrder: i,
    })),
  );
}

const summary = (input: PackingListInput) => {
  const t = packingTotals(input.items);
  return `${t.packages} packages, ${t.grossKg} kg gross, ${t.cbm} m³`;
};

/** Make a packing list for an invoice (several are allowed, e.g. for part shipments). */
export async function createPackingList(actor: SessionUser, invoiceId: string, input: PackingListInput) {
  assertCan(actor, "invoices.manage");
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!inv) throw new NotFoundError("Invoice");
  if (inv.status === "cancelled") throw new DomainError("This invoice is cancelled, so it cannot be shipped.");
  return db.transaction(async (tx) => {
    const plNo = await nextReference(tx, "PL", Number(input.packDate.slice(0, 4)));
    const [pl] = await tx
      .insert(packingLists)
      .values({ plNo, invoiceId, queryId: inv.queryId, customerId: inv.customerId, ...header(input), createdBy: actor.id })
      .returning({ id: packingLists.id, plNo: packingLists.plNo });
    await writeLines(tx, pl.id, input);
    await recordAudit(tx, { userId: actor.id, action: "create", entityType: "packing_list", entityId: pl.id, summary: `Created packing list ${plNo} for ${inv.invoiceNo}: ${summary(input)}` });
    return pl;
  });
}

/** Packing lists stay editable: shipping details are often known only when the goods leave. */
export async function updatePackingList(actor: SessionUser, id: string, input: PackingListInput) {
  assertCan(actor, "invoices.manage");
  const [pl] = await db.select().from(packingLists).where(and(eq(packingLists.id, id), isNull(packingLists.deletedAt))).limit(1);
  if (!pl) throw new NotFoundError("Packing list");
  await db.transaction(async (tx) => {
    await tx.update(packingLists).set({ ...header(input), updatedAt: new Date() }).where(eq(packingLists.id, id));
    await writeLines(tx, id, input);
    await recordAudit(tx, { userId: actor.id, action: "update", entityType: "packing_list", entityId: id, summary: `Updated packing list ${pl.plNo}: ${summary(input)}` });
  });
}

export async function deletePackingList(actor: SessionUser, id: string) {
  assertCan(actor, "invoices.manage");
  const [pl] = await db.select().from(packingLists).where(and(eq(packingLists.id, id), isNull(packingLists.deletedAt))).limit(1);
  if (!pl) throw new NotFoundError("Packing list");
  await db.transaction(async (tx) => {
    await tx.update(packingLists).set({ deletedAt: new Date() }).where(eq(packingLists.id, id));
    await recordAudit(tx, { userId: actor.id, action: "delete", entityType: "packing_list", entityId: id, summary: `Removed packing list ${pl.plNo}` });
  });
  return pl;
}
