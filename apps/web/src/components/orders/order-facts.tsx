import Link from "next/link";
import { cn } from "@kebo/ui";
import { date } from "@/lib/format";
import type { OrderFlow } from "@/lib/types-flow";
import type { OrderView } from "@/lib/types-orders";
import { SideSection } from "./side-panel-parts";

const DAY = 86_400_000;

/**
 * Key dates, beside every page of the order: what has happened and what comes
 * next, in order. The next day to come says how far it is; one that has passed
 * without happening says how late.
 */
export function KeyDates({ o, flow, now }: { o: OrderView; flow: OrderFlow | null; now: string }) {
  const ship = flow?.shipping?.shipments[0] ?? null;
  const dv = flow?.delivery ?? null;
  const ready = flow?.factory.readyOn ?? o.readyOn;
  const sailed = ship?.departedOn ?? o.shippedOn ?? null;
  const goodsIn = o.goods?.allReceived ?? false;
  // [label, the day, it has happened]
  const rows: [string, string | null, boolean][] = [
    ["Ordered", o.orderedOn, true],
    ["Factory ordered", flow?.factory.orderedOn ?? null, true],
    ["Goods ready", ready, goodsIn || !!sailed],
    ["Ship by", o.shipBy, !!sailed],
    [sailed ? "Sailed" : "Sails", sailed ?? ship?.etd ?? null, !!sailed],
    [ship?.arrivedOn ? "Arrived" : "Arrives", ship?.arrivedOn ?? ship?.eta ?? null, !!ship?.arrivedOn],
    ["Delivered", dv?.deliveredOn ?? null, true],
    [dv?.satDoneOn ? "SAT signed" : "SAT planned", dv?.satDoneOn ?? dv?.satPlannedOn ?? null, !!dv?.satDoneOn],
  ];
  // Always the four people plan by; the others once they have a day.
  const always = new Set(["Goods ready", "Ship by", "Sails", "Arrives"]);
  const shown = rows.filter(([label, day]) => day || always.has(label));
  const next = shown.find(([, day, happened]) => day && !happened);
  return (
    <SideSection title="Key dates">
      {shown.map(([label, day, happened]) => {
        const days = day ? Math.round((Date.parse(day) - Date.parse(now)) / DAY) : 0;
        const isNext = next?.[0] === label;
        const late = !!day && !happened && days < 0;
        return (
          <li key={label} className="flex items-baseline justify-between gap-3 py-1 text-[13px]">
            <span className="text-text-2">{label}</span>
            <span className={cn("text-right tabular", !day ? "text-muted" : late ? "font-semibold text-bad" : isNext ? "font-semibold text-action" : happened ? "text-text-2" : "font-semibold")}>
              {day ? date(day) : "—"}
              {late ? ` · ${-days} day${days === -1 ? "" : "s"} late` : isNext ? (days === 0 ? " · today" : ` · in ${days} day${days === 1 ? "" : "s"}`) : ""}
            </span>
          </li>
        );
      })}
    </SideSection>
  );
}

/** People, beside every page of the order: the customer and their contact, who handles it, the factories, the forwarder, the banks. */
export function OrderPeople({ o, flow, first }: { o: OrderView; flow: OrderFlow | null; first?: "Forwarder" | "Factory" }) {
  const ship = flow?.shipping?.shipments[0] ?? null;
  const contract = flow?.payment.bankContract ?? null;
  const factories = flow?.factory.factories ?? [];
  const rows: { role: string; name: string; sub?: string | null; href?: string }[] = [
    { role: "Customer", name: o.customer.name, sub: o.contactName ?? null, href: `/customers/${o.customer.id}` },
    ...(o.inquiry.assignee ? [{ role: "Handles it", name: o.inquiry.assignee.name }] : []),
    ...factories.map((x) => ({ role: "Factory", name: x.name, sub: flow?.factory.orderNo ? `their order ${flow.factory.orderNo}` : null, href: `/factories/${x.id}` })),
    ...(ship?.forwarder ? [{ role: "Forwarder", name: ship.forwarder, sub: ship.bookingNo ? `booking ${ship.bookingNo}` : null }] : []),
    ...(contract && (contract.customerBank || contract.ourBank)
      ? [{ role: "Banks", name: [contract.customerBank, contract.ourBank].filter(Boolean).join(" → "), sub: contract.number }]
      : []),
  ];
  if (first) rows.sort((a, b) => Number(b.role === first) - Number(a.role === first));
  return (
    <SideSection title="People">
      {rows.map((p, i) => (
        <li key={`${p.role}-${i}`} className="flex items-baseline justify-between gap-3 py-1 text-[13px]">
          <span className="shrink-0 text-text-2">{p.role}</span>
          <span className="min-w-0 text-right">
            {p.href ? (
              <Link href={p.href} className="font-semibold [overflow-wrap:anywhere] hover:underline">
                {p.name}
              </Link>
            ) : (
              <span className="font-semibold [overflow-wrap:anywhere]">{p.name}</span>
            )}
            {p.sub && <span className="block text-xs text-text-2">{p.sub}</span>}
          </span>
        </li>
      ))}
    </SideSection>
  );
}
