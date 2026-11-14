import { CHANNEL_LABEL, LOST_REASON_LABEL, rowsOf, SENT_VIA_LABEL, type Message, type MessageListRow } from "@kebo/shared";
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

/* ---------------------------------------------------------------- reminders (every morning) */

const late = (n: number) => `${n} day${n === 1 ? "" : "s"} late`;

/** An inquiry still new, or asking factories too long. */
export function inquiryWaiting(i: InquiryFacts, why: "new" | "sourcing", days: number, offers: { in: number; asked: number } | null): Message {
  const isNew = why === "new";
  return {
    kind: isNew ? "reminder.new" : "reminder.sourcing",
    group: "sales",
    tag: "Inquiry waiting",
    subject: isNew
      ? `${i.refNo} from ${i.customerName} is still new after ${days} day${days === 1 ? "" : "s"}${i.handler ? "" : " — nobody handles it"}`
      : `${i.refNo} from ${i.customerName}: asking factories for ${days} days, no quotation yet`,
    sentence: isNew
      ? `The inquiry from ${i.customerName} came in ${days} day${days === 1 ? "" : "s"} ago and no factory has been asked yet.`
      : `Factories are being asked for prices for ${days} days${offers && offers.asked ? `: ${offers.in} of ${offers.asked} have sent an offer` : offers?.in ? `: ${offers.in} offer${offers.in === 1 ? "" : "s"} in` : ""}. The customer has no quotation yet.`,
    where: where(i),
    people: rowsOf([
      ["Customer", i.customer],
      ["Contact", i.contact],
      ["Handled by", i.handler ?? "Nobody yet"],
    ]),
    next: isNew
      ? i.handler
        ? "Ask factories for prices, or tell the customer when they will hear from you."
        : "Give it to someone, so the customer gets an answer."
      : "Send the quotation with the offers you have, or tell the customer where it stands.",
    button: isNew ? "Open the inquiry" : "Open the factory offers",
    link: isNew ? paths.inquiry(i.id) : paths.sourcing(i.id),
  };
}

/** The customer's needed-by date is close, or passed, and the inquiry is still open. */
export function neededBy(i: InquiryFacts, passed: boolean): Message {
  return {
    kind: passed ? "reminder.overdue" : "reminder.dueSoon",
    group: "sales",
    tag: passed ? "Needed-by date passed" : "Needed soon",
    subject: passed
      ? `${i.customerName} needed ${i.refNo} by ${day(i.needed)} — the date has passed`
      : `${i.customerName} needs ${i.refNo} by ${day(i.needed)}`,
    sentence: `${i.customerName} asked for it by ${day(i.needed)}${passed ? ", and that day has passed" : ""}. The inquiry is still open.`,
    where: where(i),
    people: rowsOf([
      ["Customer", i.customer],
      ["Contact", i.contact],
      ["Handled by", i.handler ?? "Nobody yet"],
    ]),
    next: passed ? "Tell the customer where it stands and agree a new date." : "Make sure the quotation goes before that day.",
    button: "Open the inquiry",
    link: paths.inquiry(i.id),
    urgent: passed,
  };
}

/** A sent quotation ends soon without an answer, or ended. */
export function quotationEnding(i: InquiryFacts, r: RevisionFacts, ended: boolean): Message {
  return {
    kind: ended ? "reminder.quotationExpired" : "reminder.quotationDue",
    group: "sales",
    tag: ended ? "Quotation ended" : "Quotation ending",
    subject: ended ? `Quotation to ${i.customerName} ended without an answer (${r.ref})` : `Quotation to ${i.customerName} ends ${day(r.validUntil)} — no answer yet (${r.ref})`,
    sentence: ended
      ? `Quotation ${r.ref} to ${i.customerName} ended on ${day(r.validUntil)}. The customer never answered.`
      : `Quotation ${r.ref} to ${i.customerName} is valid until ${day(r.validUntil)}, and the customer has not answered.`,
    where: { ref: i.refNo, title: [i.title, r.sentOn ? `sent ${day(r.sentOn.toISOString().slice(0, 10))}` : null].filter(Boolean).join(" · ") },
    people: rowsOf([
      ["Customer", i.customer],
      ["Contact", i.contact],
      ["Handled by", i.handler],
    ]),
    money: rowsOf(optionRows(r)),
    next: ended ? "Ask the customer once more, make a new revision, or mark the inquiry lost." : "Call the customer before it ends, or make a new revision with a later date.",
    button: "Open the quotation",
    link: paths.quotation(i.id),
    urgent: ended,
  };
}

/** What an order is waiting on (from orderNeeds), past its day: the words and where it is done. */
function needAction(title: string) {
  if (/^Get the deposit/.test(title)) return { tag: "Deposit late", next: "Ask the customer for the deposit and send the proforma invoice again.", where: "money" as const };
  if (/^Get the balance/.test(title)) return { tag: "Balance late", next: "Ask the customer for the balance. Do not hand over the documents before it is in.", where: "money" as const };
  if (/ready date/.test(title)) return { tag: "Ready date missing", next: "Ask the factory when the goods will be ready and enter the date.", where: "production" as const };
  if (/^Goods (due|coming)/.test(title)) return { tag: "Goods late", next: "Call the factory for a new date, then tell the customer.", where: "production" as const };
  if (/packing list|mark as shipped/.test(title)) return { tag: "Ready to ship", next: "Make the packing list and book the shipment.", where: "shipping" as const };
  if (/close the order/.test(title)) return { tag: "Order to close", next: "Everything is paid: close the order.", where: "order" as const };
  return { tag: "Order waiting", next: "Open the order and move it on.", where: "order" as const };
}

export function orderWaiting(o: OrderFacts, need: { title: string; due: string; lateBy: number }): Message {
  const a = needAction(need.title);
  const link = a.where === "money" ? paths.orderMoney(o.id) : a.where === "production" ? paths.production(o.id) : a.where === "shipping" ? paths.shipping(o.id) : paths.order(o.id);
  return {
    kind: "reminder.order",
    group: a.where === "money" ? "money" : "orders",
    tag: a.tag,
    subject: `${o.refNo} for ${o.customerName}: ${need.title} — ${late(need.lateBy)}`,
    sentence: `${need.title}: it was due on ${day(need.due)}, ${late(need.lateBy)}.`,
    where: orderWhere(o),
    people: rowsOf([
      ["Customer", o.customer],
      ["Contact", o.contact],
      ["Factory", o.factories.join(", ") || null],
      ["Handled by", o.handler],
    ]),
    money: rowsOf([
      ["Order value", o.value],
      ["Paid so far", o.paidSoFar],
    ]),
    next: a.next,
    button: "Open the order",
    link,
    urgent: need.lateBy >= 3,
  };
}

/** Several orders late at once: one message with the list. */
export function ordersLate(items: MessageListRow[], links: { link: string }, team: boolean): Message {
  const x = items[0]!;
  return {
    kind: team ? "reminder.orderEscalated" : "reminder.order",
    group: "orders",
    tag: "Orders late",
    subject: `${items.length} ${team ? "" : "of your "}orders are late — the oldest, ${x.ref} (${x.party}) by ${x.when.replace(" late", "")}`,
    sentence: team ? "These orders are waiting on something past its day, long enough for the managers to be told." : "These orders are waiting on you, past their day.",
    list: items,
    next: team ? "Ask who handles each one, or give it to someone who can move it." : "Open each one and move it on.",
    button: "Open the orders",
    link: links.link,
    urgent: true,
  };
}

/** A customer's instalment due soon, or late. */
export function paymentDue(o: OrderFacts, part: { label: string; openMinor: number; dueOn: string | null }, lateBy: number | null): Message {
  const amount = money(part.openMinor, o.currency);
  const what = part.label.toLowerCase();
  return lateBy !== null
    ? {
        kind: "reminder.instalmentLate",
        group: "money",
        tag: "Payment late",
        subject: `Late: ${o.customerName} has not paid ${amount} (${what}, ${o.refNo})`,
        sentence: `The ${what} of ${o.refNo} was due on ${day(part.dueOn)}. It is ${late(lateBy)}.`,
        where: orderWhere(o),
        people: rowsOf([
          ["Customer", o.customer],
          ["Contact", o.contact],
          ["Handled by", o.handler],
        ]),
        money: rowsOf([
          ["Late", `${amount} · ${late(lateBy)}`],
          ["Paid so far", o.paidSoFar],
        ]),
        next: "Call the customer. Do not ship or hand over documents before it is in.",
        button: "Open the order's money",
        link: paths.orderMoney(o.id),
        urgent: true,
      }
    : {
        kind: "reminder.instalment",
        group: "money",
        tag: "Payment due soon",
        subject: `${o.customerName} owes ${amount} (${what}, ${o.refNo}) by ${day(part.dueOn)}`,
        sentence: `The ${what} of ${o.refNo} is due on ${day(part.dueOn)} and is not paid yet.`,
        where: orderWhere(o),
        people: rowsOf([
          ["Customer", o.customer],
          ["Contact", o.contact],
          ["Handled by", o.handler],
        ]),
        money: rowsOf([
          ["Due", `${amount} on ${day(part.dueOn)}`],
          ["Paid so far", o.paidSoFar],
        ]),
        next: "Remind the customer and send them the bank details again.",
        button: "Open the order's money",
        link: paths.orderMoney(o.id),
      };
}

/** What we owe a factory falls due today or soon, or is late. */
export function factoryPayment(
  o: OrderFacts,
  f: { factory: string; contact: string | null; currency: string; owed: string; paid: string },
  row: { label: string; open: string; due: string | null; lateBy: number | null },
): Message {
  const amount = money(toMinorText(row.open), f.currency);
  const what = row.label.toLowerCase();
  const when = row.lateBy !== null ? late(row.lateBy) : row.due ? `due ${day(row.due)}` : "due";
  return {
    kind: row.lateBy !== null ? "reminder.factoryLate" : "reminder.factoryDue",
    group: "orders",
    tag: "Pay the factory",
    subject: `Pay ${f.factory}: ${amount} ${what} (${o.refNo}) — ${when}`,
    sentence: `The ${what} we owe ${f.factory} for ${o.refNo} (${o.customerName}) is ${row.lateBy !== null ? `${late(row.lateBy)}` : `due on ${day(row.due)}`} and not paid yet.`,
    where: orderWhere(o),
    people: rowsOf([
      ["Factory", [f.factory, f.contact].filter(Boolean).join(" · ")],
      ["Customer", o.customer],
      ["Handled by", o.handler],
    ]),
    money: rowsOf([
      ["To pay", `${amount} · ${what}`],
      ["Paid to the factory", `${money(toMinorText(f.paid), f.currency)} of ${money(toMinorText(f.owed), f.currency)}`],
      ["Customer has paid", o.paidSoFar],
    ]),
    next: "Pay the factory, or record the payment if it is already made.",
    button: "Pay the factory",
    link: paths.factory(o.id),
    urgent: row.lateBy !== null,
  };
}

const toMinorText = (v: string) => Math.round(Number(v) * 100);

/* ---------------------------------------------------------------- the morning email */

/** One email a morning to each person: everything of theirs, in sections. Only when something needs them. */
export function yourDay(name: string, sections: { title: string; rows: MessageListRow[] }[]): Message {
  const count = (t: string) => sections.find((s) => s.title === t)?.rows.length ?? 0;
  const parts = [
    [count("Follow-ups today"), "follow-up", "follow-ups"],
    [count("Missed"), "missed", "missed"],
    [count("Money to collect"), "payment to collect", "payments to collect"],
    [count("Pay the factory"), "factory payment", "factory payments"],
    [count("Orders waiting on you"), "order waiting", "orders waiting"],
    [count("Quotations ending"), "quotation ending", "quotations ending"],
    [count("Inquiries waiting"), "inquiry waiting", "inquiries waiting"],
    [count("Missed by your team"), "missed by your team", "missed by your team"],
    [count("Late across the team"), "order late in the team", "orders late in the team"],
  ] as [number, string, string][];
  const said = parts.filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  const first = name.split(/\s+/)[0] ?? name;
  return {
    kind: "digest.day",
    group: "people",
    tag: "Your day",
    subject: `Good morning ${first}: ${said.slice(0, 3).join(", ")}${said.length > 3 ? ", and more" : ""}`,
    sentence: "Everything that needs you today, most urgent first.",
    tiles: parts
      .filter(([n]) => n > 0)
      .slice(0, 4)
      .map(([n, one, many]) => ({ value: String(n), label: n === 1 ? one : many, bad: one === "missed" || one.includes("team") })),
    sections: sections.filter((s) => s.rows.length),
    next: "Start with the missed and the late ones.",
    button: "Open my day",
    link: "/dashboard",
  };
}

/* ---------------------------------------------------------------- follow-ups */

type FollowUpLike = { title: string; dueOn: string; dueAt: string | null; place: string | null; note: string | null };
type RefLike = { label?: string | null; link: string } | null;
const refWhere = (ref: RefLike, title: string) => {
  if (!ref?.label) return null;
  const [n, ...rest] = ref.label.split(" · ");
  return { ref: n!, title: rest.join(" · ") || title };
};
const when = (f: FollowUpLike) => `${day(f.dueOn)}${f.dueAt ? ` ${f.dueAt}` : ""}`;

/** On the day (in the morning), or 30 minutes before its time. */
export function followUpToday(f: FollowUpLike, ref: RefLike, inMinutes: number | null): Message {
  const soon = inMinutes !== null;
  return {
    kind: "followUp.due",
    group: "followups",
    tag: soon ? (inMinutes ? `In ${inMinutes} minutes` : "Now") : "Follow-up today",
    subject: soon ? `At ${f.dueAt}: ${f.title}` : `Today${f.dueAt ? ` at ${f.dueAt}` : ""}: ${f.title}`,
    sentence: soon ? `Your follow-up is ${inMinutes ? `in ${inMinutes} minutes` : "now"}${f.place ? `, at ${f.place}` : ""}.` : `Your follow-up is today${f.dueAt ? ` at ${f.dueAt}` : ""}${f.place ? `, at ${f.place}` : ""}.${f.note ? `\n${f.note}` : ""}`,
    where: refWhere(ref, f.title),
    people: rowsOf([["About", ref?.label]]),
    next: `${f.title}. When done, say what happened and set the next one.`,
    button: "Open the follow-up",
    link: ref?.link ?? "/follow-ups",
  };
}

/** Missed: to the person it is for, every morning; to the managers and who gave it from two days. */
export function followUpMissed(f: FollowUpLike, ref: RefLike, days: number, toldAbout: string | null): Message {
  const d = `${days} day${days === 1 ? "" : "s"}`;
  return {
    kind: toldAbout ? "followUp.missedTold" : "followUp.missed",
    group: "followups",
    tag: toldAbout ? "Missed by your team" : "Follow-up missed",
    subject: toldAbout ? `${toldAbout} missed a follow-up for ${d}: ${f.title}` : `Missed ${d}: ${f.title}`,
    sentence: `${toldAbout ? `${toldAbout}'s follow-up` : "This follow-up"} was due on ${when(f)} and is not done.`,
    where: refWhere(ref, f.title),
    people: rowsOf([
      ["About", ref?.label],
      ["For", toldAbout],
    ]),
    next: toldAbout ? `Ask ${toldAbout.split(" ")[0]}, or give it to someone else.` : "Do it today, or move it to the day you will.",
    button: "Open the follow-up",
    link: ref?.link ?? "/follow-ups",
    urgent: true,
  };
}

/** Many missed at once: one message with the list (the oldest first). */
export function followUpsMissed(rows: MessageListRow[], told: boolean, oldest: string): Message {
  return {
    kind: told ? "followUp.missedTold" : "followUp.missed",
    group: "followups",
    tag: told ? "Missed by your team" : "Follow-ups missed",
    subject: `${rows.length} follow-ups ${told ? "missed by your team" : "missed"} — the oldest, ${oldest}`,
    sentence: told ? "These follow-ups are two days or more past their day." : "These follow-ups are past their day and not done.",
    list: rows,
    next: told ? "Ask who they are for, or give each one to someone else." : "Do them today, or move each one to the day you will.",
    button: "Open the missed follow-ups",
    link: "/follow-ups?status=late",
    urgent: true,
  };
}
