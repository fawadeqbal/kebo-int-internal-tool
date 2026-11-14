import { CHANNEL_LABEL, LOST_REASON_LABEL, rowsOf, SENT_VIA_LABEL, type Message } from "@kebo/shared";
import { day, money, type InquiryFacts, type OrderFacts, type RevisionFacts } from "./facts";

/**
 * Every message the system sends about inquiries, quotations, orders and money, written in trade words from
 * the record's facts (claude/messages-design.md). Each returns the whole message; NotificationsService.send
 * puts it in the bell, on the phone and in the email.
 */

export const paths = {
  inquiry: (id: string) => `/inquiries/${id}`,
  sourcing: (id: string) => `/inquiries/${id}/sourcing`,
  quotation: (id: string) => `/inquiries/${id}/quotation`,
  order: (id: string) => `/orders/${id}`,
  orderMoney: (id: string) => `/orders/${id}/payment`,
  factory: (id: string) => `/orders/${id}/factory`,
  production: (id: string) => `/orders/${id}/production`,
  shipping: (id: string) => `/orders/${id}/shipping`,
};

const where = (i: InquiryFacts) => ({ ref: i.refNo, title: i.what });
const orderWhere = (o: OrderFacts, extra?: string | null) => ({ ref: o.refNo, title: [o.title, extra].filter(Boolean).join(" · ") });

/* ---------------------------------------------------------------- inquiries */

export function inquiryNew(i: InquiryFacts, by: string | null): Message {
  const how = i.channel === "website" ? "by the website form" : `by ${CHANNEL_LABEL[i.channel as keyof typeof CHANNEL_LABEL]?.toLowerCase() ?? "email"}`;
  return {
    kind: "inquiry.created",
    group: "sales",
    tag: "New inquiry",
    subject: `New inquiry from ${i.customerName}: ${i.title}`,
    sentence: `${i.customerName} sent a new inquiry ${how}${by && i.channel !== "website" ? `, added by ${by}` : ""}. ${i.handler ? `${i.handler} handles it.` : "Nobody handles it yet."}`,
    where: where(i),
    people: rowsOf([
      ["Customer", i.customer],
      ["Contact", i.contact],
      ["Handled by", i.handler ?? "Nobody yet"],
    ]),
    next: i.handler ? `${i.handler} replies to the customer within a day.` : "Give it to someone, so the customer gets an answer within a day.",
    button: "Open the inquiry",
    link: paths.inquiry(i.id),
  };
}

export function inquiryYours(i: InquiryFacts, by: string | null): Message {
  return {
    kind: "inquiry.assigned",
    group: "sales",
    tag: "Inquiry for you",
    subject: `${i.refNo} is yours: ${i.customerName}, ${i.title}`,
    sentence: by ? `${by} gave you the inquiry from ${i.customerName}.` : `You handle the inquiry from ${i.customerName}.`,
    where: where(i),
    people: rowsOf([
      ["Customer", i.customer],
      ["Contact", i.contact],
      ["Given by", by],
    ]),
    next: "Reply to the customer today, then ask two or three factories for prices.",
    button: "Open the inquiry",
    link: paths.inquiry(i.id),
  };
}

export function inquiryLost(i: InquiryFacts, by: string | null, lastQuoted: string | null, orderCancelled: string | null): Message {
  const reason = i.lostReason ? LOST_REASON_LABEL[i.lostReason] : null;
  return {
    kind: "inquiry.lost",
    group: "sales",
    tag: "Lost",
    subject: `Lost: ${i.customerName}, ${i.title}${reason ? ` — ${reason.toLowerCase()}` : ""}`,
    sentence: orderCancelled
      ? `The inquiry from ${i.customerName} is lost: its sales order ${orderCancelled} was cancelled${by ? ` by ${by}` : ""}.`
      : `The inquiry from ${i.customerName} is marked lost${by ? ` by ${by}` : ""}.${reason ? ` Reason: ${reason.toLowerCase()}.` : ""}${i.lostNote ? `\nNote: “${i.lostNote}”` : ""}`,
    where: where(i),
    people: rowsOf([
      ["Customer", i.customer],
      ["Handled by", i.handler],
      ["Marked by", by],
    ]),
    money: rowsOf([["Last quoted", lastQuoted]]),
    next: "Nothing to do. It can be opened again from its page.",
    button: "Open the inquiry",
    link: paths.inquiry(i.id),
  };
}

/* ---------------------------------------------------------------- quotations */

const optionRows = (r: RevisionFacts) => (r.options.length === 1 ? [["Quoted", r.options[0]!.text]] : r.options.map((o) => [`Option ${o.letter}`, o.text])) as [string, string][];

export function quotationSent(i: InquiryFacts, r: RevisionFacts, by: string | null): Message {
  const via = r.sentVia ? SENT_VIA_LABEL[r.sentVia as keyof typeof SENT_VIA_LABEL]?.toLowerCase() : null;
  return {
    kind: "quotation.sent",
    group: "sales",
    tag: "Quotation sent",
    subject: `Quotation ${r.ref} sent to ${i.customerName}${r.headline ? ` — ${r.headline}` : ""}`,
    sentence: `${by ?? "Someone"} sent quotation ${r.ref} to ${i.customerName}${via && via !== "another way" ? ` by ${via}` : ""}.`,
    where: { ref: i.refNo, title: `${i.title} · valid until ${day(r.validUntil)}` },
    people: rowsOf([
      ["Customer", i.customer],
      ["Sent to", i.contact],
      ["Sent by", by],
    ]),
    money: rowsOf(optionRows(r)),
    next: "Follow-ups come by themselves: 3, 7 and 14 days on, until the customer answers.",
    button: "Open the quotation",
    link: paths.quotation(i.id),
  };
}

export function quotationAccepted(i: InquiryFacts, r: RevisionFacts, o: OrderFacts | null, by: string | null): Message {
  const option = r.chosen && r.options.length > 1 ? `Option ${r.chosen.letter} of ` : "";
  return {
    kind: "quotation.accepted",
    group: "sales",
    tag: "Customer accepted",
    subject: `${i.customerName} accepted quotation ${r.ref}${r.headline ? ` — ${r.headline}` : ""}`,
    sentence: `${i.customerName} accepted ${option}quotation ${r.ref}.${r.order?.customerRef ? ` Their order number is ${r.order.customerRef}.` : ""} The inquiry is won${o ? ` and sales order ${o.refNo} is made` : ""}.`,
    where: { ref: i.refNo, title: o ? `${i.title} → sales order ${o.refNo}` : i.title },
    people: rowsOf([
      ["Customer", i.customer],
      ["Contact", i.contact],
      ["Handled by", i.handler],
      ["Marked by", by],
    ]),
    money: o
      ? rowsOf([
          ["Order value", `${o.value}${o.terms ? ` · ${o.terms}` : ""}`],
          ["Deposit", o.depositMinor > 0 ? money(o.depositMinor, o.currency) : null],
          ["Paid so far", o.paidSoFar],
        ])
      : rowsOf(optionRows(r)),
    next: "Send the proforma invoice and ask for the deposit.",
    button: o ? "Open the sales order" : "Open the inquiry",
    link: o ? paths.order(o.id) : paths.inquiry(i.id),
  };
}

export function quotationRejected(i: InquiryFacts, r: RevisionFacts, by: string | null, reason: string | null): Message {
  return {
    kind: "quotation.rejected",
    group: "sales",
    tag: "Customer said no",
    subject: `${i.customerName} turned down quotation ${r.ref}`,
    sentence: `${i.customerName} turned down quotation ${r.ref}.${reason ? ` Reason given: “${reason}”` : ""}`,
    where: where(i),
    people: rowsOf([
      ["Customer", i.customer],
      ["Contact", i.contact],
      ["Handled by", i.handler],
      ["Marked by", by],
    ]),
    money: rowsOf(optionRows(r)),
    next: "Ask what price would work and make a new revision, or mark the inquiry lost.",
    button: "Open the quotation",
    link: paths.quotation(i.id),
  };
}

/* ---------------------------------------------------------------- money */

export function paymentIn(o: OrderFacts, amount: string, by: string | null, paidOn: string | null): Message {
  return {
    kind: "payment.in",
    group: "money",
    tag: "Payment received",
    subject: `Payment in: ${amount} from ${o.customerName} (${o.refNo})`,
    sentence: `${o.customerName} paid ${amount} on ${o.refNo}${paidOn ? `, received ${day(paidOn)}` : ""}.`,
    where: orderWhere(o),
    people: rowsOf([
      ["Customer", o.customer],
      ["Recorded by", by],
      ["Handled by", o.handler],
    ]),
    money: rowsOf([
      ["Received", amount],
      ["Paid so far", o.paidSoFar],
      ["Still to come", o.dueMinor > 0 ? (o.nextLine ?? money(o.dueMinor, o.currency)) : "Nothing: paid in full"],
    ]),
    next: o.stage === "confirmed" ? "Send the purchase order to the factory and pay its advance." : o.dueMinor > 0 ? "Nothing now: the next payment is reminded when it is due." : "Paid in full: the goods can be shipped.",
    button: "Open the order's money",
    link: paths.orderMoney(o.id),
  };
}

/* ---------------------------------------------------------------- orders and the factory */

export function purchaseOrderSent(
  o: OrderFacts,
  po: { number: string; factory: string; contact: string | null; amount: string | null; advance: string | null; by: string | null; early: string | null },
): Message {
  return {
    kind: "order.purchaseOrderSent",
    group: "orders",
    tag: "Purchase order",
    subject: `Purchase order ${po.number} sent to ${po.factory}${po.amount ? ` — ${po.amount}` : ""}`,
    sentence: `${po.by ?? "Someone"} sent purchase order ${po.number} to ${po.factory} for ${o.refNo} (${o.customerName}).${po.early ? `\nSent before the customer's deposit was verified: “${po.early}”` : ""}`,
    where: { ref: po.number, title: `for ${o.refNo} · ${o.customerName} · ${o.title}` },
    people: rowsOf([
      ["Factory", [po.factory, po.contact].filter(Boolean).join(" · ")],
      ["Customer", o.customer],
      ["Sent by", po.by],
    ]),
    money: rowsOf([
      ["Order to the factory", po.amount],
      ["Advance", po.advance],
      ["Customer has paid", o.paidSoFar],
    ]),
    next: "Pay the factory's advance and ask them for the ready date.",
    button: "Open the purchase order",
    link: paths.factory(o.id),
  };
}

export function shipped(
  o: OrderFacts,
  s: { departedOn: string | null; eta: string | null; vessel: string | null; blNo: string | null; port: string | null; to: string | null; forwarder: string | null; container: string | null },
): Message {
  const sailed = s.departedOn ? `sailed ${day(s.departedOn)}` : "has left";
  return {
    kind: "order.shipped",
    group: "orders",
    tag: "Shipped",
    subject: `Shipped: ${o.refNo} for ${o.customerName} ${sailed}${s.eta ? `, arrives about ${day(s.eta)}` : ""}`,
    sentence: `The goods of ${o.refNo} ${s.departedOn ? `left${s.port ? ` ${s.port}` : ""} on ${day(s.departedOn)}` : "have left"}${s.vessel ? ` on ${s.vessel}` : ""}${s.blNo ? `, B/L ${s.blNo}` : ""}.`,
    where: orderWhere(o, [s.container, s.to ? `to ${s.to}` : null].filter(Boolean).join(" · ") || null),
    people: rowsOf([
      ["Customer", o.customer],
      ["Contact", o.contact],
      ["Forwarder", s.forwarder],
      ["Handled by", o.handler],
    ]),
    money: rowsOf([
      ["Customer paid", o.paidSoFar],
      ["Still to come", o.dueMinor > 0 ? (o.nextLine ?? money(o.dueMinor, o.currency)) : null],
    ]),
    next: o.dueMinor > 0 ? "Send the customer the documents and ask for the rest of the money." : "Send the customer the documents: invoice, packing list, B/L.",
    button: "Open shipping",
    link: paths.shipping(o.id),
  };
}
