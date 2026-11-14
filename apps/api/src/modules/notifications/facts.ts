import { fromDbDate, fromDbDateOrNull } from "@kebo/database";
import { toMinor } from "@kebo/money";
import { contactLine, planStatus } from "@kebo/shared";
import type { ISODate } from "@kebo/utils";
import type { PrismaService } from "../../database/prisma.service";
import { fxOf, livePlanOf, positionOf } from "../billing/api";
import { positionRelations } from "../billing/position";
import type { Settings } from "@kebo/shared";

/**
 * What a message says about its record, read once: the customer and their contact, who handles it, the money.
 * Every message is written from these, so the same names and amounts appear in every email.
 */

const regions = new Intl.DisplayNames(["en"], { type: "region" });
/** "Nigeria" from "NG" (nothing for an unknown country). */
export function countryName(code: string | null | undefined) {
  if (!code || code === "ZZ") return null;
  try {
    return regions.of(code) ?? null;
  } catch {
    return null;
  }
}

/** "USD 119,500" (cents only when there are some). */
export function money(minor: number, currency: string) {
  const whole = minor % 100 === 0;
  return `${currency} ${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** "14 Dec 2026" */
export const day = (iso: ISODate | null | undefined) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null;

/** "14 Dec" */
export const dayShort = (iso: ISODate | null | undefined) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : null;

/** "Lagos Water Ltd · Nigeria" */
export const customerLine = (c: { name: string; country: string | null }) => [c.name, countryName(c.country)].filter(Boolean).join(" · ");

type Db = PrismaService["db"];

/** An inquiry as messages tell it. */
export async function inquiryFacts(db: Db, id: string) {
  const i = await db.inquiry.findUnique({
    where: { id },
    select: {
      id: true,
      refNo: true,
      title: true,
      stage: true,
      channel: true,
      requiredBy: true,
      createdAt: true,
      assigneeId: true,
      createdById: true,
      lostReason: true,
      lostNote: true,
      assignee: { select: { name: true } },
      customer: { select: { name: true, country: true, contacts: { where: { deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1, select: { name: true, phone: true, whatsapp: true, email: true } } } },
      contact: { select: { name: true, phone: true, whatsapp: true, email: true } },
      _count: { select: { items: true } },
    },
  });
  if (!i) return null;
  const contact = i.contact ?? i.customer.contacts[0] ?? null;
  const items = i._count.items;
  const needed = fromDbDateOrNull(i.requiredBy);
  return {
    ...i,
    customerName: i.customer.name,
    customer: customerLine(i.customer),
    contact: contactLine(contact),
    contactName: contact?.name ?? null,
    handler: i.assignee?.name ?? null,
    /** "Complete water bottling plant · 3 items · needed by 20 Dec 2026" */
    what: [i.title, items ? `${items} item${items === 1 ? "" : "s"}` : null, needed ? `needed by ${day(needed)}` : null].filter(Boolean).join(" · "),
    needed,
  };
}
export type InquiryFacts = NonNullable<Awaited<ReturnType<typeof inquiryFacts>>>;

/** An order as messages tell it, with its money: the value, what is paid, the next instalment. */
export async function orderFacts(db: Db, id: string, s: Settings, expensesOn: boolean, today: ISODate) {
  const o = await db.order.findUnique({
    where: { id },
    select: {
      id: true,
      refNo: true,
      currency: true,
      total: true,
      depositPercent: true,
      mainCurrency: true,
      mainRate: true,
      incoterm: true,
      incotermPlace: true,
      documentTitle: true,
      customerRef: true,
      stage: true,
      ...positionRelations,
      customer: { select: { name: true, country: true, contacts: { where: { deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1, select: { name: true, phone: true, whatsapp: true, email: true } } } },
      inquiry: {
        select: {
          id: true,
          refNo: true,
          title: true,
          assigneeId: true,
          createdById: true,
          requiredBy: true,
          assignee: { select: { name: true } },
          contact: { select: { name: true, phone: true, whatsapp: true, email: true } },
        },
      },
      lines: { where: { factoryId: { not: null } }, select: { factory: { select: { name: true } } } },
    },
  });
  if (!o) return null;
  const fx = fxOf(s, expensesOn);
  const pos = positionOf(o, fx);
  const plan = await livePlanOf(db, id);
  const parts = planStatus(plan.items, pos.settledMinor, today, s.reminders.dueSoonDays);
  const next = parts.find((p) => p.status !== "paid") ?? null;
  const contact = o.inquiry.contact ?? o.customer.contacts[0] ?? null;
  const factories = [...new Set(o.lines.map((l) => l.factory?.name).filter((n): n is string => !!n))];
  const totalMinor = toMinor(o.total.toString());
  return {
    ...o,
    title: o.documentTitle || o.inquiry.title,
    customerName: o.customer.name,
    customer: customerLine(o.customer),
    contact: contactLine(contact),
    handler: o.inquiry.assignee?.name ?? null,
    handlerId: o.inquiry.assigneeId,
    factories,
    totalMinor,
    value: money(totalMinor, o.currency),
    terms: [o.incoterm, o.incotermPlace].filter(Boolean).join(" "),
    receivedMinor: pos.settledMinor,
    dueMinor: pos.dueMinor,
    depositMinor: pos.depositMinor,
    /** "USD 35,850 of USD 119,500" / "Nothing" */
    paidSoFar: pos.settledMinor > 0 ? `${money(pos.settledMinor, o.currency)} of ${money(pos.owedMinor, o.currency)}` : "Nothing",
    parts,
    /** The next instalment not paid: "USD 83,650 · balance, due 5 Dec 2026". */
    next,
    nextLine: next ? [money(next.openMinor, o.currency), [next.label.toLowerCase(), next.dueOn ? `due ${day(next.dueOn)}` : null].filter(Boolean).join(", ")].join(" · ") : null,
    neededBy: fromDbDateOrNull(o.inquiry.requiredBy),
  };
}
export type OrderFacts = NonNullable<Awaited<ReturnType<typeof orderFacts>>>;

/** A sent (or answered) quotation revision: its options and totals. */
export async function revisionFacts(db: Db, id: string) {
  const r = await db.quotationRevision.findUnique({
    where: { id },
    select: {
      id: true,
      number: true,
      currency: true,
      incoterm: true,
      incotermPlace: true,
      validUntil: true,
      sentOn: true,
      sentVia: true,
      depositPercent: true,
      createdById: true,
      createdBy: { select: { name: true } },
      quotation: { select: { refNo: true, inquiryId: true } },
      options: { orderBy: { sortOrder: "asc" }, select: { letter: true, total: true, status: true } },
      order: { select: { id: true, refNo: true, customerRef: true } },
    },
  });
  if (!r) return null;
  const terms = [r.incoterm, r.incotermPlace].filter(Boolean).join(" ");
  const options = r.options.map((o) => ({ letter: o.letter, status: o.status, minor: toMinor(o.total.toString()), text: `${money(toMinor(o.total.toString()), r.currency)}${terms ? ` · ${terms}` : ""}` }));
  const chosen = options.find((o) => o.status === "accepted") ?? null;
  return {
    ...r,
    ref: `${r.quotation.refNo} R${r.number}`,
    validUntil: fromDbDate(r.validUntil),
    options,
    chosen,
    /** The total people quote in a subject: the chosen option's, else the first. */
    headline: chosen ? money(chosen.minor, r.currency) : options[0] ? money(options[0].minor, r.currency) : null,
  };
}
export type RevisionFacts = NonNullable<Awaited<ReturnType<typeof revisionFacts>>>;
