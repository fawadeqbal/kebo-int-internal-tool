import { decimalToMinor, toDbDate } from "@kebo/database";
import { formatMinor, fromMinor, type Minor } from "@kebo/money";
import { receivedForMinor, type PaymentKind } from "@kebo/shared";
import { DomainError, type ISODate } from "@kebo/utils";
import type { PrismaService, Tx } from "../../database/prisma.service";

/**
 * Customer money the ERPNext way: one payment entry per transfer (money_movements) and what it pays underneath
 * (allocations). What a movement's live allocations do not take is the customer's credit (their advance),
 * worked out by the view movement_unallocated. These are the only writers of the two tables' credit rules:
 * paying from credit, paying it back, keeping it as a fee and releasing a cancelled order all go through here.
 * Callers lock the customer (parties row) and post the ledger.
 */

type Db = PrismaService["db"] | Tx;

/** The customer's credit per currency (what their money in still has unallocated). */
export async function creditOf(db: Db, partyId: string): Promise<Record<string, Minor>> {
  const rows = await db.$queryRaw<{ currency: string; minor: string }[]>`
    select currency::text, sum(unallocated)::text as minor from movement_unallocated
     where party_id = ${partyId}::uuid group by 1`;
  return Object.fromEntries(rows.map((r) => [r.currency, decimalToMinor(r.minor)]).filter(([, m]) => m !== 0));
}

/** Every customer's credit per currency (reports, the ledger check). */
export async function creditsAll(db: Db): Promise<{ partyId: string; currency: string; minor: Minor }[]> {
  const rows = await db.$queryRaw<{ partyId: string; currency: string; minor: string }[]>`
    select party_id::text as "partyId", currency::text, sum(unallocated)::text as minor from movement_unallocated group by 1, 2`;
  return rows.map((r) => ({ partyId: r.partyId, currency: r.currency, minor: decimalToMinor(r.minor) }));
}

export interface FromCredit {
  partyId: string;
  currency: string;
  amountMinor: Minor;
  target: "order" | "refund" | "fee";
  /** The order it pays (target order), or the cancelled order the money came from (fee, refund). */
  orderId?: string | null;
  refundId?: string;
  kind?: PaymentKind;
  on: ISODate;
  note?: string | null;
  recordedById: string;
  /** Movements to take from first (a cancelled order's own money); then the oldest. */
  prefer?: string[];
}

/**
 * Takes an amount of the customer's credit for an order, a refund or a fee: allocations on their money in with
 * something unallocated, the movements preferred first, then the oldest (FIFO). Returns the allocations' ids.
 */
export async function fromCredit(tx: Tx, a: FromCredit): Promise<string[]> {
  const open = await tx.$queryRaw<{ id: string; unallocated: string; currency: string; allocCurrency: string; rate: string }[]>`
    select u.id::text, u.unallocated::text, m.currency::text, m.alloc_currency::text as "allocCurrency", m.rate::text
      from movement_unallocated u join money_movements m on m.id = u.id
     where u.party_id = ${a.partyId}::uuid and u.currency = ${a.currency} and u.unallocated > 0
     order by (u.id = any(${a.prefer ?? []}::uuid[])) desc, u.value_date, u.created_at, u.id`;
  const have = open.reduce((t, m) => t + decimalToMinor(m.unallocated), 0);
  if (a.amountMinor > have) throw new DomainError(`The customer has ${formatMinor(have, a.currency)} of credit.`);
  const ids: string[] = [];
  let left = a.amountMinor;
  for (const m of open) {
    if (left <= 0) break;
    const take = Math.min(left, decimalToMinor(m.unallocated));
    const row = await tx.allocation.create({
      data: {
        movementId: m.id,
        target: a.target,
        orderId: a.orderId ?? null,
        refundId: a.target === "refund" ? a.refundId : null,
        kind: a.kind ?? "balance",
        amount: fromMinor(take),
        share: fromMinor(receivedForMinor(take, m.rate, m.currency === m.allocCurrency)),
        on: toDbDate(a.on),
        later: true,
        note: a.note ?? null,
        recordedById: a.recordedById,
      },
    });
    ids.push(row.id);
    left -= take;
  }
  return ids;
}

/**
 * An order cancelled: what paid it is released (removed with the reason, its movement stands), so the money is
 * the customer's credit again. Returns the movements it came from and how much.
 */
export async function releaseOrder(
  tx: Tx,
  orderId: string,
  reason: string,
): Promise<{ movementIds: string[]; minor: Minor; ids: string[] }> {
  const parts = await tx.allocation.findMany({
    where: { orderId, target: "order", voidedAt: null },
    select: { id: true, movementId: true, amount: true },
  });
  if (parts.length)
    await tx.allocation.updateMany({ where: { id: { in: parts.map((p) => p.id) } }, data: { voidedAt: new Date(), voidReason: reason } });
  return {
    movementIds: [...new Set(parts.map((p) => p.movementId))],
    minor: parts.reduce((t, p) => t + decimalToMinor(p.amount), 0),
    ids: parts.map((p) => p.id),
  };
}

export interface Refund {
  partyId: string;
  currency: string;
  amountMinor: Minor;
  accountId: string | null;
  on: ISODate;
  note: string | null;
  recordedById: string;
  prefer?: string[];
  /** The cancelled order it is paid back for, if any. */
  orderId?: string | null;
}

/** Credit paid back: money out to the customer, drawn from their money in (FIFO). Returns the movement's id. */
export async function refund(tx: Tx, r: Refund): Promise<string> {
  const out = await tx.moneyMovement.create({
    data: {
      direction: "out",
      partyRole: "customer",
      partyId: r.partyId,
      amount: fromMinor(r.amountMinor),
      currency: r.currency,
      allocCurrency: r.currency,
      rate: 1,
      allocatable: fromMinor(r.amountMinor),
      accountId: r.accountId,
      valueDate: toDbDate(r.on),
      note: r.note,
      recordedById: r.recordedById,
    },
  });
  try {
    await fromCredit(tx, { ...r, target: "refund", refundId: out.id });
  } catch (e) {
    if (e instanceof DomainError) throw new DomainError(e.message.replace("of credit.", "of credit to refund."));
    throw e;
  }
  return out.id;
}

/**
 * A movement recorded by mistake: it and everything it pays are removed. Refused while part of it was used
 * later (from credit) or paid back: that is removed first.
 */
export async function voidMovement(tx: Tx, id: string, reason: string): Promise<{ orderIds: string[]; partIds: string[] }> {
  const m = await tx.moneyMovement.findUniqueOrThrow({ where: { id }, include: { allocations: { where: { voidedAt: null } } } });
  if (m.direction === "in" && m.allocations.some((a) => a.later))
    throw new DomainError("Part of this transfer's credit was already used or refunded. Remove that first.");
  const now = new Date();
  await tx.moneyMovement.update({ where: { id }, data: { voidedAt: now, voidReason: reason } });
  // Money out: what it paid back is credit again.
  await tx.allocation.updateMany({
    where: { OR: [{ movementId: id }, { refundId: id }], voidedAt: null },
    data: { voidedAt: now, voidReason: reason },
  });
  return {
    orderIds: [...new Set(m.allocations.flatMap((a) => (a.orderId ? [a.orderId] : [])))],
    partIds: m.allocations.map((a) => a.id),
  };
}
