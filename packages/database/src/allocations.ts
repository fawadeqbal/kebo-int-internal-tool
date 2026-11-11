import type { Prisma } from "./generated/prisma/client";

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
