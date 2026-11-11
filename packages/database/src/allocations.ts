import type { Prisma } from "./generated/prisma/client";
import { fileOf, liveFile } from "./files";

/**
 * Customer money is a payment entry (money_movements: what arrived or left) and what it pays underneath
 * (allocations: an order, an advance paid back, an advance kept as a fee). What a movement's live allocations do
 * not take is the customer's credit (the view movement_unallocated). These are the shapes every reader shares.
 */

/** What pays an order (its parts, removed or not). */
export const orderPart = { target: "order" } as const satisfies Prisma.AllocationWhereInput;

/** What pays an order now. */
export const livePart = { target: "order", voidedAt: null } as const satisfies Prisma.AllocationWhereInput;

/** An order's live parts with their payment entry's facts, in date order (papers, receipts, reports). */
export const livePartsWithEntry = {
  where: livePart,
  orderBy: [{ on: "asc" }, { createdAt: "asc" }],
  include: {
    movement: {
      select: {
        id: true,
        reference: true,
        method: true,
        currency: true,
        amount: true,
        rate: true,
        allocCurrency: true,
        paidByName: true,
        accountId: true,
        note: true,
      },
    },
  },
} as const satisfies Prisma.Order$allocationsArgs;

type PartWithEntry = Prisma.AllocationGetPayload<{ include: (typeof livePartsWithEntry)["include"] }>;

/** An order's part read as a payment on the order: its money facts from its entry (from credit: none of its own). */
export const asPayment = (a: PartWithEntry) => ({
  id: a.id,
  receiptNo: a.receiptNo,
  kind: a.kind,
  amount: a.amount,
  bankCharges: a.bankCharges,
  currency: a.movement.allocCurrency,
  paidOn: a.on,
  reference: a.later ? null : a.movement.reference,
  method: a.later ? ("credit" as const) : a.movement.method,
  movementId: a.movementId,
  createdAt: a.createdAt,
});

type Amount = string | number | Prisma.Decimal;

export interface PaymentIn {
  partyId: string;
  orderId: string;
  kind?: "deposit" | "balance" | "other";
  /** What it counts as on the order, in the order's currency. */
  amount: Amount;
  bankCharges?: Amount;
  /** The order's currency. */
  currency: string;
  /** What arrived and in what (the order's currency and the amount, unless said). */
  receivedAmount?: Amount;
  receivedCurrency?: string;
  /** Units of the received currency per one of the order's. */
  rate?: Amount;
  accountId?: string | null;
  paidOn: Date;
  method?: Prisma.MoneyMovementUncheckedCreateInput["method"];
  reference?: string | null;
  paidByName?: string | null;
  note?: string | null;
  recordedById: string;
  voidedAt?: Date | null;
  voidReason?: string | null;
}

/** Money in that pays one order in full (the seed, imports, tests): the movement with its one allocation. */
export function paymentIn(p: PaymentIn) {
  return {
    direction: "in",
    partyRole: "customer",
    partyId: p.partyId,
    amount: p.receivedAmount ?? p.amount,
    currency: p.receivedCurrency ?? p.currency,
    allocCurrency: p.currency,
    rate: p.rate ?? 1,
    allocatable: p.amount,
    accountId: p.accountId ?? null,
    valueDate: p.paidOn,
    method: p.method ?? "bank_transfer",
    reference: p.reference ?? null,
    paidByName: p.paidByName ?? null,
    note: p.note ?? null,
    recordedById: p.recordedById,
    voidedAt: p.voidedAt ?? null,
    voidReason: p.voidReason ?? null,
    allocations: {
      create: {
        target: "order",
        orderId: p.orderId,
        kind: p.kind ?? "balance",
        amount: p.amount,
        bankCharges: p.bankCharges ?? 0,
        share: p.receivedAmount ?? p.amount,
        on: p.paidOn,
        recordedById: p.recordedById,
        voidedAt: p.voidedAt ?? null,
        voidReason: p.voidReason ?? null,
      },
    },
  } satisfies Prisma.MoneyMovementUncheckedCreateInput;
}

/** Records money in on one order; returns its allocation's id (the payment on the order) and the movement's. */
export async function createPaymentIn(
  db: { moneyMovement: Prisma.TransactionClient["moneyMovement"] },
  p: PaymentIn,
): Promise<{ id: string; movementId: string }> {
  const m = await db.moneyMovement.create({ data: paymentIn(p), include: { allocations: true } });
  return { id: m.allocations[0]!.id, movementId: m.id };
}

/** What pays what we owe a supplier on an order (its purchase). */
export const purchasePart = { target: "purchase" } as const satisfies Prisma.AllocationWhereInput;
export const livePurchase = { target: "purchase", voidedAt: null } as const satisfies Prisma.AllocationWhereInput;

/** A supplier payment as the factory's money reads it: who, in what currency, how much, at what rate. */
export const purchasesWithEntry = {
  where: livePurchase,
  orderBy: [{ on: "asc" }, { createdAt: "asc" }],
  include: { movement: { include: { files: liveFile } } },
} as const satisfies Prisma.Order$supplierPaidArgs;

type PurchaseWithEntry = Prisma.AllocationGetPayload<{ include: { movement: { include: { files: typeof liveFile } } } }>;

/** A purchase allocation read as a payment to the supplier (as factory_payments had it). */
export const asSupplierPayment = (a: PurchaseWithEntry) => ({
  id: a.id,
  movementId: a.movementId,
  orderId: a.purchaseOrderId!,
  factoryId: a.movement.partyId!,
  kind: a.kind,
  /** What was paid, in the supplier's currency. */
  amount: a.share,
  currency: a.movement.currency,
  /** Units of the currency paid per one of the order's. */
  rate: a.movement.rate,
  paidOn: a.on,
  method: a.movement.method,
  paidById: a.movement.paidById,
  reference: a.movement.reference,
  note: a.movement.note,
  accountId: a.movement.accountId,
  ...fileOf(a.movement.files),
  recordedById: a.movement.recordedById,
  voidedAt: a.voidedAt ?? a.movement.voidedAt,
  voidReason: a.voidReason ?? a.movement.voidReason,
  createdAt: a.createdAt,
  updatedAt: a.movement.updatedAt,
});

export interface SupplierPayment {
  orderId: string;
  supplierId: string;
  /** The order's currency. */
  orderCurrency: string;
  kind?: "deposit" | "balance" | "other";
  amount: Amount;
  currency: string;
  /** Units of `currency` per one of the order's. */
  rate: Amount;
  accountId?: string | null;
  paidOn: Date;
  method?: Prisma.MoneyMovementUncheckedCreateInput["method"];
  paidById?: string | null;
  reference?: string | null;
  note?: string | null;
  recordedById: string;
}

/** A supplier payment: money out to the supplier, paying their part of one order. */
export function supplierPayment(p: SupplierPayment) {
  const counts = Math.max(Math.round((Number(p.amount) / Number(p.rate)) * 100) / 100, 0.01).toFixed(2);
  return {
    direction: "out",
    partyRole: "supplier",
    partyId: p.supplierId,
    amount: p.amount,
    currency: p.currency,
    allocCurrency: p.orderCurrency,
    rate: p.rate,
    allocatable: counts,
    accountId: p.accountId ?? null,
    paidById: p.paidById ?? null,
    valueDate: p.paidOn,
    method: p.method ?? "bank_transfer",
    reference: p.reference ?? null,
    note: p.note ?? null,
    recordedById: p.recordedById,
    allocations: {
      create: {
        target: "purchase",
        purchaseOrderId: p.orderId,
        kind: p.kind ?? "deposit",
        amount: counts,
        share: p.amount,
        on: p.paidOn,
        recordedById: p.recordedById,
      },
    },
  } satisfies Prisma.MoneyMovementUncheckedCreateInput;
}

/** Records a supplier payment; returns its allocation's id (the payment on the order) and the movement's. */
export async function createSupplierPayment(
  db: { moneyMovement: Prisma.TransactionClient["moneyMovement"] },
  p: SupplierPayment,
): Promise<{ id: string; movementId: string }> {
  const m = await db.moneyMovement.create({ data: supplierPayment(p), include: { allocations: true } });
  return { id: m.allocations[0]!.id, movementId: m.id };
}
