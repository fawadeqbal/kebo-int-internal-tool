import { and, eq, isNull } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/db";
import { invoiceItems, invoices, packingListItems, packingLists } from "@/lib/db/schema";
import { assertCan, type SessionUser } from "@/lib/auth/session";
import { nextReference } from "@/lib/counters";
import { packingTotals } from "@/lib/packing";
import { DomainError, NotFoundError } from "@/lib/utils/result";
import { recordAudit } from "@/modules/audit/service";
import { getSettings } from "@/modules/settings/service";
import { companySnapshot, customerSnapshotFor } from "@/modules/documents/snapshots";
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

/**
 * The goods on the invoice, packed: the item, model, HS code, quantity and unit
 * are taken from the invoice lines; the form only says how each is packed.
 * Service lines (freight, inspection…) are simply not included.
 */
async function writeLines(tx: DbOrTx, packingListId: string, invoiceId: string, input: PackingListInput) {
  const all = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId)).orderBy(invoiceItems.sortOrder);
  const packed = new Map(input.items.map((l) => [l.sourceId, l]));
  if ([...packed.keys()].some((id) => !all.some((l) => l.id === id))) throw new DomainError("A line is not on this invoice any more. Reload the page.");
  const lines = all.filter((l) => packed.has(l.id));
  await tx.delete(packingListItems).where(eq(packingListItems.packingListId, packingListId));
  await tx.insert(packingListItems).values(
    lines.map((it, i) => {
      const p = packed.get(it.id)!;
      return {
        packingListId,
        invoiceItemId: it.id,
        description: it.description,
        model: it.model,
        hsCode: it.hsCode,
        quantity: it.quantity,
        unit: it.unit,
        packages: p.packages,
        packageType: p.packageType,
        netWeight: String(p.netWeight),
        grossWeight: String(p.grossWeight),
        cbm: String(p.cbm),
        sortOrder: i,
      };
    }),
  );
}

const summary = (input: PackingListInput) => {
  const t = packingTotals(input.items);
  return `${t.packages} packages, ${t.grossKg} kg gross, ${t.cbm} m³`;
};

/** The packing list of an invoice (one shipment per invoice). */
export async function createPackingList(actor: SessionUser, invoiceId: string, input: PackingListInput) {
  assertCan(actor, "invoices.manage");
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!inv) throw new NotFoundError("Invoice");
  if (inv.status === "cancelled") throw new DomainError("This invoice is cancelled, so it cannot be shipped.");
  const [existing] = await db
    .select({ plNo: packingLists.plNo })
    .from(packingLists)
    .where(and(eq(packingLists.invoiceId, invoiceId), isNull(packingLists.deletedAt)))
    .limit(1);
  if (existing) throw new DomainError(`This invoice already has its packing list (${existing.plNo}). Open it to make changes.`);
  const settings = await getSettings();
  return db.transaction(async (tx) => {
    const plNo = await nextReference(tx, "PL", Number(input.packDate.slice(0, 4)));
    const [pl] = await tx
      .insert(packingLists)
      .values({
        plNo,
        invoiceId,
        queryId: inv.queryId,
        customerId: inv.customerId,
        ...header(input),
        customerSnapshot: inv.customerSnapshot ?? (await customerSnapshotFor(tx, inv.customerId)),
        companySnapshot: inv.companySnapshot ?? companySnapshot(settings),
        createdBy: actor.id,
      })
      .returning({ id: packingLists.id, plNo: packingLists.plNo });
    await writeLines(tx, pl.id, invoiceId, input);
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
    await writeLines(tx, id, pl.invoiceId, input);
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
