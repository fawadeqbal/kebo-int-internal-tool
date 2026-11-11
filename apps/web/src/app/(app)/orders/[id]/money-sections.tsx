import { Badge, cn } from "@kebo/ui";
import type { orderOf } from "@/lib/order-data";
import { money } from "@/lib/format";
import type { PaymentStatus } from "@/lib/types-orders";

/** The money parts of the Payment and Factory order steps (moved from the old Payments tab, unchanged). */

const PAY_STATUS: Record<PaymentStatus, { label: string; tone: "neutral" | "warn" | "info" | "ok" }> = {
  unpaid: { label: "Nothing received", tone: "warn" },
  partly_paid: { label: "Part-paid", tone: "warn" },
  deposit_paid: { label: "Deposit received", tone: "info" },
  paid: { label: "Paid in full", tone: "ok" },
  overpaid: { label: "Overpaid", tone: "warn" },
};

/** One part of the tab: what it is and whose money, its one button, then its tables. */
export function MoneySection({
  id,
  target,
  icon,
  title,
  sub,
  tag,
  action,
  children,
}: {
  id: string;
  /** Where checklist links land (see goTo). */
  target?: string;
  icon: React.ReactNode;
  title: string;
  sub: string;
  tag?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      data-target={target}
      data-target-card={target ? "" : undefined}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-24 overflow-hidden rounded-xl border border-line bg-surface"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text-2 [&_svg]:size-4">
            {icon}
          </span>
          <span className="min-w-0">
            <h2 id={`${id}-title`} className="flex flex-wrap items-center gap-2 text-base font-semibold">
              {title} {tag && <Badge tone="neutral">{tag}</Badge>}
            </h2>
            <span className="block text-sm text-text-2">{sub}</span>
          </span>
        </div>
        {action && <div className="has-[form]:basis-full">{action}</div>}
      </div>
      <div className="flex flex-col gap-5 p-4">{children}</div>
    </section>
  );
}

/** The three numbers, how much is in (with the deposit marked), and where the money stands. */
export function CustomerSummary({ o }: { o: Awaited<ReturnType<typeof orderOf>> }) {
  const c = o.currency;
  const st = PAY_STATUS[o.money.status] ?? { label: o.money.status, tone: "neutral" as const };
  const charged = Number(o.money.charged ?? 0);
  // Everything the customer owes: the order and what was charged to them.
  const owed = Number(o.money.total) + charged;
  const pct = owed > 0 ? Math.min(100, Math.round((Number(o.money.received) / owed) * 100)) : 0;
  const due = Number(o.money.due);
  // The deposit asked for (the plan's deposit row, else the accepted %): its % and where it sits on the bar.
  const depositPct = o.money.depositPercent ?? o.depositPercent;
  const depositAt = owed > 0 ? Math.round((Number(o.money.deposit) / owed) * 1000) / 10 : 0;
  return (
    <section aria-label="Money from the customer" className="flex flex-col gap-4 rounded-lg bg-surface-2/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <dl className="grid flex-1 grid-cols-3 gap-3 sm:flex sm:flex-none sm:gap-10">
          <div className="min-w-0">
            <dt className="text-xs text-muted">Order total</dt>
            <dd className="truncate text-base font-bold tabular sm:text-xl">{money(o.money.total, c)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted">Received</dt>
            <dd className="truncate text-base font-bold text-ok tabular sm:text-xl">{money(o.money.received, c)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted">Still due</dt>
            <dd className={cn("truncate text-base font-bold tabular sm:text-xl", due > 0.005 ? "text-warn" : "text-ok")}>
              {money(o.money.due, c)}
            </dd>
            {charged > 0.005 && <dd className="truncate text-xs text-muted tabular">incl. {money(o.money.charged, c)} charged</dd>}
          </div>
        </dl>
        <Badge tone={st.tone} dot>
          {st.label}
        </Badge>
      </div>
      <div className="flex flex-col gap-1.5">
        <div
          className="relative h-2.5 overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={`${pct}% of the order received`}
        >
          <div className="h-full rounded-full bg-ok" style={{ width: `${pct}%` }} />
          {depositPct > 0 && depositAt > 0 && depositAt < 100 && (
            <span
              aria-hidden
              className="absolute top-0 bottom-0 w-0.5 bg-surface"
              style={{ left: `${depositAt}%` }}
              title={`Deposit ${depositPct}%`}
            />
          )}
        </div>
        <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-muted">
          <span>
            {pct}% received
            {depositPct > 0 &&
              (Number(o.money.depositDue) > 0 ? (
                <span className="text-warn">
                  {" "}
                  · deposit ({depositPct}%): {money(o.money.depositDue, c)} still missing
                </span>
              ) : (
                <span className="text-ok"> · deposit ({depositPct}%) received</span>
              ))}
          </span>
          {Number(o.money.bankCharges) > 0 && <span>received includes {money(o.money.bankCharges, c)} bank charges</span>}
        </p>
      </div>
    </section>
  );
}
