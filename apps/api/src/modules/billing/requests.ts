import { decimalToMinor, fromDbDate, fromDbDateOrNull, livePart, routeOf, termsSelect } from "@kebo/database";
import { fromMinor, spreadPayments, type Minor } from "@kebo/money";
import { paperNumber, requestState, type RequestState } from "@kebo/shared";
import { dateIn, type ISODate } from "@kebo/utils";
import type { PrismaService, Tx } from "../../database/prisma.service";

type Db = PrismaService["db"] | Tx;

/**
 * Payment requests with a status (claude/core-plan.md, phase 1). A plan row is a payment request: the same
 * columns, with where it stands. Nothing here is stored twice or typed by hand:
 *
 * - sent: from the copy kept when it was sent (order_papers, kind payment-request, ref = the row), or for the
 *   deposit the proforma (its issue date), or on a bank route the balance once the documents went to our bank;
 * - part paid / paid: from the money received, earliest row first (the one rule everywhere);
 * - which payments paid a row: the same rule, payment by payment (spreadPayments);
 * - cancelled: a kept copy whose row is no longer in the plan.
 */

/** How a row was asked for. */
export type SentWith = "request" | "proforma" | "bank";

/** One copy kept when a request was sent (R1, R2…). */
export interface KeptCopy {
  paperId: string;
  ref: string;
  number: string;
  revision: number;
  sentOn: ISODate;
  sentBy: { id: string; name: string } | null;
  /** What it asked for, as sent. */
  amount: string | null;
  dueOn: ISODate | null;
  label: string | null;
}

export interface SentFacts {
  with: SentWith;
  on: ISODate;
  by: { id: string; name: string } | null;
  /** The request's revision (1, 2…); null when the proforma or the bank papers asked for it. */
  revision: number | null;
  /** The proforma's number, when it asked for the deposit. */
  proformaNo: string | null;
  amount: string | null;
  dueOn: ISODate | null;
}

/** A payment that paid (part of) a row, with its receipt. */
export interface RowReceipt {
  id: string;
  number: string;
  /** What of this payment went to the row. */
  amount: string;
  paidOn: ISODate;
}

export interface OrderRequests {
  /** Per plan row: how and when it was sent (absent: not sent). */
  sent: Map<string, SentFacts>;
  /** The rows asked for through the banks (a bank route's balance): no request goes to the customer for them. */
  byBank: Set<string>;
  /** Per plan row: every copy kept, oldest first. */
  copies: Map<string, KeptCopy[]>;
  /** Per plan row: the payments that paid it. */
  receipts: Map<string, RowReceipt[]>;
  /** Copies whose row is no longer in the plan: cancelled requests. */
  gone: KeptCopy[];
}

const text = (v: unknown) => (typeof v === "string" && v ? v : null);

/** The requests of several orders, by order id. */
export async function requestsOf(db: Db, orderIds: string[], timeZone: string): Promise<Map<string, OrderRequests>> {
  const out = new Map<string, OrderRequests>();
  if (!orderIds.length) return out;
  const orders = await db.order.findMany({
    where: { id: { in: orderIds } },
    select: {
      id: true,
      refNo: true,
      proformaNo: true,
      proformaIssuedOn: true,
      ...termsSelect,
      receivables: { orderBy: { sortOrder: "asc" }, select: { id: true, amount: true, part: true } },
      allocations: {
        where: livePart,
        orderBy: [{ on: "asc" }, { createdAt: "asc" }],
        select: { id: true, amount: true, bankCharges: true, on: true, receiptNo: true },
      },
      bankSteps: { where: { step: "sent_to_our_bank" }, select: { doneOn: true } },
      papers: {
        where: { kind: "payment-request", status: "final" },
        orderBy: { version: "asc" },
        select: {
          id: true,
          ref: true,
          number: true,
          version: true,
          options: true,
          finalAt: true,
          madeAt: true,
          madeBy: { select: { id: true, name: true } },
        },
      },
    },
  });
  for (const o of orders) {
    const rowIds = new Set(o.receivables.map((r) => r.id));
    const copies = new Map<string, KeptCopy[]>();
    const gone: KeptCopy[] = [];
    for (const p of o.papers) {
      const opts = (p.options ?? {}) as Record<string, unknown>;
      const copy: KeptCopy = {
        paperId: p.id,
        ref: p.ref,
        number: p.number,
        revision: p.version,
        sentOn: dateIn(p.finalAt ?? p.madeAt, timeZone),
        sentBy: p.madeBy,
        amount: text(opts.amount),
        dueOn: text(opts.dueOn) as ISODate | null,
        label: text(opts.label),
      };
      if (rowIds.has(p.ref) || p.ref === "balance") copies.set(p.ref, [...(copies.get(p.ref) ?? []), copy]);
      else gone.push(copy);
    }
    const sent = new Map<string, SentFacts>();
    const bankRoute = routeOf(o) === "letter_of_credit" || routeOf(o) === "bank_contract";
    const toBank = fromDbDateOrNull(o.bankSteps[0]?.doneOn ?? null);
    for (const r of o.receivables) {
      const last = copies.get(r.id)?.at(-1);
      if (last)
        sent.set(r.id, {
          with: "request",
          on: last.sentOn,
          by: last.sentBy,
          revision: last.revision,
          proformaNo: null,
          amount: last.amount,
          dueOn: last.dueOn,
        });
      else if (r.part === "deposit" && o.proformaNo && o.proformaIssuedOn)
        sent.set(r.id, {
          with: "proforma",
          on: fromDbDate(o.proformaIssuedOn),
          by: null,
          revision: null,
          proformaNo: o.proformaNo,
          amount: null,
          dueOn: null,
        });
      else if (r.part === "balance" && bankRoute && toBank)
        sent.set(r.id, { with: "bank", on: toBank, by: null, revision: null, proformaNo: null, amount: null, dueOn: null });
    }
    // Which payments paid which row: money pays the earliest row first, payment by payment.
    const spread = spreadPayments(
      o.receivables.map((r) => ({ amountMinor: decimalToMinor(r.amount) })),
      o.allocations.map((a) => ({ id: a.id, minor: decimalToMinor(a.amount) + decimalToMinor(a.bankCharges) })),
    );
    const receipts = new Map<string, RowReceipt[]>();
    o.allocations.forEach((a, i) => {
      for (const part of spread.get(a.id) ?? []) {
        const rowId = o.receivables[part.index]!.id;
        receipts.set(rowId, [
          ...(receipts.get(rowId) ?? []),
          {
            id: a.id,
            number: paperNumber(o.refNo, "payment-receipt", a.receiptNo ?? i + 1),
            amount: fromMinor(part.minor),
            paidOn: fromDbDate(a.on),
          },
        ]);
      }
    });
    const byBank = new Set(bankRoute ? o.receivables.filter((r) => r.part === "balance").map((r) => r.id) : []);
    out.set(o.id, { sent, byBank, copies, receipts, gone });
  }
  return out;
}

/** One order's requests. */
export async function requestsOfOrder(db: Db, orderId: string, timeZone: string): Promise<OrderRequests> {
  return (
    (await requestsOf(db, [orderId], timeZone)).get(orderId) ?? {
      sent: new Map(),
      byBank: new Set(),
      copies: new Map(),
      receipts: new Map(),
      gone: [],
    }
  );
}

/** The request facts of one plan row, as the screens show them. */
export interface RequestView {
  state: RequestState;
  with: SentWith | null;
  sentOn: ISODate | null;
  sentBy: { id: string; name: string } | null;
  revision: number | null;
  proformaNo: string | null;
  /** How it is asked for: a request to the customer, or the papers through the banks (a bank route's balance). */
  through: "customer" | "bank";
  /** Sent as a request, still open, and the row no longer says what was sent (amount or due date): send it again. */
  changed: boolean;
  receipts: RowReceipt[];
}

export function requestViewOf(
  row: { id: string; amountMinor: Minor; paidMinor: Minor; openMinor: Minor; dueOn: ISODate | null },
  r: OrderRequests | undefined,
): RequestView {
  const sent = r?.sent.get(row.id) ?? null;
  const state = requestState(row, !!sent);
  return {
    state,
    with: sent?.with ?? null,
    sentOn: sent?.on ?? null,
    sentBy: sent?.by ?? null,
    revision: sent?.revision ?? null,
    proformaNo: sent?.proformaNo ?? null,
    through: r?.byBank.has(row.id) ? "bank" : "customer",
    changed:
      !!sent &&
      sent.with === "request" &&
      row.openMinor > 0 &&
      ((sent.amount !== null && sent.amount !== fromMinor(row.amountMinor)) || (sent.dueOn ?? null) !== (row.dueOn ?? null)),
    receipts: r?.receipts.get(row.id) ?? [],
  };
}
