import type { FlowStep, OrderStepFacts } from "@kebo/shared";
import { date } from "@/lib/format";
import type { OrderFlow } from "@/lib/types-flow";
import type { OrderView } from "@/lib/types-orders";
import type { OrderMoney } from "@/lib/types-money";
import type { PanelTone } from "@/components/records/panel-pieces";

const DAY = 86_400_000;

/**
 * The order's key dates for its panel: what has happened and what comes next, in order. The next day to come
 * says how far it is; one that has passed without happening says how late.
 */
export function keyDates(o: OrderView, flow: OrderFlow | null, now: string): { label: string; value: string; tone?: PanelTone }[] {
  const ship = flow?.shipping?.shipments[0] ?? null;
  const dv = flow?.delivery ?? null;
  const ready = flow?.factory.readyOn ?? o.readyOn;
  const sailed = ship?.departedOn ?? o.shippedOn ?? null;
  const goodsIn = o.goods?.allReceived ?? false;
  // Once every line is in: the day the last one came, not the supplier's ready date (review 24 Nov, O-43).
  const inOn = goodsIn
    ? (o.lines ?? [])
        .filter((l) => l.type === "goods")
        .map((l) => l.receivedOn)
        .filter((d): d is string => !!d)
        .sort()
        .at(-1) ?? null
    : null;
  // [label, the day, it has happened]
  const rows: [string, string | null, boolean][] = [
    ["Ordered", o.orderedOn, true],
    ["Supplier ordered", flow?.factory.orderedOn ?? null, true],
    [goodsIn ? "Goods in" : "Goods ready", goodsIn ? (inOn ?? ready) : ready, goodsIn || !!sailed],
    ["Ship by", o.shipBy, !!sailed],
    [sailed ? "Sailed" : "Sails", sailed ?? ship?.etd ?? null, !!sailed],
    [ship?.arrivedOn ? "Arrived" : "Arrives", ship?.arrivedOn ?? ship?.eta ?? null, !!ship?.arrivedOn],
    ["Cleared customs", ship?.clearedOn ?? null, true],
    ["Delivered", dv?.deliveredOn ?? null, true],
    ["Installed", dv?.installedOn ?? null, true],
    [dv?.satDoneOn ? "SAT signed" : "SAT planned", dv?.satDoneOn ?? dv?.satPlannedOn ?? null, !!dv?.satDoneOn],
  ];
  // Always the four people plan by; the others once they have a day.
  const always = new Set(["Goods ready", "Goods in", "Ship by", "Sails", "Arrives"]);
  const shown = rows.filter(([label, day]) => day || always.has(label));
  const next = shown.find(([, day, happened]) => day && !happened);
  return shown.map(([label, day, happened]) => {
    const days = day ? Math.round((Date.parse(day) - Date.parse(now)) / DAY) : 0;
    const isNext = next?.[0] === label;
    const late = !!day && !happened && days < 0;
    const value = day
      ? `${date(day)}${late ? ` · ${-days} day${days === -1 ? "" : "s"} late` : isNext ? (days === 0 ? " · today" : ` · in ${days} day${days === 1 ? "" : "s"}`) : ""}`
      : "—";
    return { label, value, tone: !day ? "done" : late ? "late" : isNext ? "next" : happened ? "done" : undefined };
  });
}

/** The order's other people for its panel: the customer's contact, the suppliers, the forwarder, the banks. */
export function orderPeople(o: OrderView, flow: OrderFlow | null): { role: string; name: string; sub?: string | null; href?: string }[] {
  const ship = flow?.shipping?.shipments[0] ?? null;
  const contract = flow?.payment.bankContract ?? null;
  const factories = flow?.factory.factories ?? [];
  return [
    // The customer is named in the header: here, who to talk to there.
    ...(o.contactName ? [{ role: "Contact", name: o.contactName, href: `/customers/${o.customer.id}` }] : []),
    ...factories.map((x) => ({ role: "Supplier", name: x.name, sub: flow?.factory.orderNo ? `their order ${flow.factory.orderNo}` : null, href: `/suppliers/${x.id}` })),
    ...(ship?.forwarder
      ? [{ role: "Forwarder", name: ship.forwarder, sub: [ship.forwarderContact, ship.forwarderPhone].filter(Boolean).join(" · ") || (ship.bookingNo ? `booking ${ship.bookingNo}` : null) }]
      : []),
    ...(ship?.customsBroker ? [{ role: "Customs broker", name: ship.customsBroker }] : []),
    ...(contract && (contract.customerBank || contract.ourBank)
      ? [{ role: "Banks", name: [contract.customerBank, contract.ourBank].filter(Boolean).join(" → "), sub: contract.number }]
      : []),
  ];
}

/**
 * What the header's next step reads from the order (packages/shared ORDER, orderNextStep): worked out from what is
 * saved, the same on every tab. `stages`: the stages the company uses (null: not known, all of them).
 */
export function orderStepFacts(
  o: OrderView,
  flow: OrderFlow | null,
  stages: FlowStep[] | null,
  may: { update: boolean },
  more: { money?: OrderMoney | null; advice?: { state: string } | null; requests?: { stateLabel: string }[] } = {},
): OrderStepFacts {
  const uses = (s: FlowStep) => !stages || stages.includes(s);
  const ship = flow?.shipping?.shipments[0] ?? null;
  const dv = flow?.delivery ?? null;
  const gone = ["Shipped", "Arrived", "Delivered", "Done"].includes(o.word);
  const sailed = gone || !!ship?.departedOn || !!o.shippedOn || (!!ship && ["departed", "arrived", "cleared"].includes(ship.status));
  const arrived = ["Arrived", "Delivered", "Done"].includes(o.word) || !!ship?.arrivedOn || (!!ship && ["arrived", "cleared"].includes(ship.status));
  const delivered = ["Delivered", "Done"].includes(o.word) || !!dv?.deliveredOn;
  const depositDue = Number(o.money.depositDue);
  const balanceDue = Math.max(0, Number(o.money.due) - Math.max(0, depositDue));
  return {
    status: o.status,
    canReopen: may.update && o.status === "closed" && !!o.back,
    canClose: may.update && o.status === "open" && o.next?.to === "done" && (o.word === "Delivered" || !uses("delivery")),
    // Not known (the flow did not load): nothing to ask for.
    routeChosen: flow ? !!flow.payment.route : true,
    depositDue: depositDue > 0 ? depositDue : 0,
    production: uses("factory") && (flow?.modules.production ?? true),
    poSent: !!flow?.factory.orderedOn || o.word !== "Confirmed",
    // The supplier's part due when we order, still open (people who see supplier money only).
    supplierDepositDue: (more.money?.factories?.plans ?? [])
      .flatMap((p) => p.rows)
      .filter((r) => r.dueRule === "on_order" && r.status !== "paid" && r.status !== "later")
      .reduce((t, r) => t + Number(r.open), 0),
    // Made by the app and not ready (missing or a draft): not sent yet. Null: no shipping advice here.
    adviceSent: more.advice ? ["ready", "else", "up"].includes(more.advice.state) : null,
    readyOn: flow?.factory.readyOn ?? o.readyOn,
    goodsIn: o.goods?.allReceived ?? false,
    shipping: uses("shipping") && (flow?.modules.shipping ?? true),
    booked: !!ship && (ship.status !== "planned" || !!ship.bookingNo),
    etd: ship?.etd ?? null,
    sailed,
    eta: ship?.eta ?? null,
    arrived,
    balanceBeforeShipment: flow?.payment.balanceWhen === "before_shipment" ? balanceDue : 0,
    // A request sent and not paid yet (a paid one says "Paid"): the balance was asked for.
    balanceAsked: (more.requests ?? []).some((r) => r.stateLabel === "Sent"),
    supplierBalanceDue: (more.money?.factories?.plans ?? [])
      .flatMap((p) => p.rows)
      .filter((r) => r.dueRule === "on_ready" && r.status !== "paid" && r.status !== "later")
      .reduce((t, r) => t + Number(r.open), 0),
    deliverySat: uses("delivery") && (flow?.modules.deliverySat ?? true),
    delivered,
    satOpen: !!dv && (!!dv.satPlannedOn || dv.sat.length > 0) && !dv.satDoneOn,
  };
}
