import Link from "next/link";
import { buttonClass, cn } from "@kebo/ui";
import { dateTime, money } from "@/lib/format";
import type { LedgerEntry } from "@/lib/types-ledger";
import { amount, TypeBadge } from "./ledger-parts";

/** Where a posting's document is in the app. */
export function sourceHref(s: LedgerEntry["source"]): { href: string; label: string } | null {
  switch (s.type) {
    // A customer's payment entry, or what it paid later from their credit: the order it pays, else the customer.
    case "movement":
    case "allocation":
      return s.orderId
        ? { href: `/orders/${s.orderId}/payment`, label: "Open the payment" }
        : s.customerId
          ? { href: `/customers/${s.customerId}`, label: "Open the customer's money" }
          : null;
    case "factory_payment":
      return s.orderId ? { href: `/orders/${s.orderId}/money`, label: "Open the factory payment" } : null;
    case "expense":
      return s.orderId
        ? { href: `/orders/${s.orderId}/costs`, label: "Open the expense" }
        : { href: "/finance/expenses", label: "Open the expenses" };
    case "transfer":
    case "account":
      return { href: "/finance/cash-book", label: "Open the cash book" };
    case "order":
    case "fx_order":
      return s.orderId ? { href: `/orders/${s.orderId}`, label: "Open the order" } : null;
    case "purchase_order":
    case "fx_factory":
      return s.orderId ? { href: `/orders/${s.orderId}/factory`, label: "Open the factory step" } : null;
    default:
      return null;
  }
}

const FILE: Record<string, string> = { payment: "payments", factory_payment: "factory-payments", expense: "expenses" };

/**
 * One posting in the side panel: both sides (as recorded, and in the main currency when it differs), what it
 * settles, who recorded and approved it, its file, its corrections, and a link to the document. Rows cannot be
 * edited: the document is changed, and the ledger posts a correction.
 */
export function EntryBody({ e, main, back }: { e: LedgerEntry; main: string; back: string }) {
  const single = new Set(e.rows.map((r) => r.currency)).size === 1;
  const cur = e.rows[0]?.currency ?? main;
  const src = sourceHref(e.source);
  const receipt =
    e.source.partId && e.source.orderId
      ? `/print/orders/${e.source.orderId}/payment-receipt?ref=${e.source.partId}&back=${encodeURIComponent(back)}`
      : null;
  const details: [string, React.ReactNode][] = [
    ["Type", <TypeBadge key="t" type={e.type} />],
    ...(e.source.settles ? ([["Settles", e.source.settles]] as [string, string][]) : []),
    [
      "Currency",
      single
        ? `${cur}${cur === main ? "" : ` (${main} at the entry's rate)`}`
        : `several (${[...new Set(e.rows.map((r) => r.currency))].join(", ")})`,
    ],
    ...(e.source.recordedBy ? ([["Recorded by", e.source.recordedBy]] as [string, string][]) : []),
    ...(e.source.approvedBy ? ([["Approved by", e.source.approvedBy]] as [string, string][]) : []),
    ...(e.reason ? ([["Reason", e.reason]] as [string, string][]) : []),
    ...(e.reverses
      ? ([
          [
            "Reverses",
            <Link key="r" href={`?panel=entry&id=${e.reverses.groupId}`} scroll={false} className="text-primary hover:underline">
              entry {e.reverses.entryNo} of {e.reverses.date}
            </Link>,
          ],
        ] as [string, React.ReactNode][])
      : []),
    ...(e.reversedBy.length
      ? ([
          [
            "Reversed by",
            <span key="rb" className="flex flex-col">
              {e.reversedBy.map((r) => (
                <Link key={r.groupId} href={`?panel=entry&id=${r.groupId}`} scroll={false} className="text-primary hover:underline">
                  entry {r.entryNo} of {r.date}
                  {r.reason ? ` · ${r.reason}` : ""}
                </Link>
              ))}
            </span>,
          ],
        ] as [string, React.ReactNode][])
      : []),
    ...(e.source.file
      ? ([
          [
            "File",
            <a key="f" href={`/files/${FILE[e.source.file.kind]}/${e.source.file.id}`} className="text-primary underline">
              {e.source.file.name}
            </a>,
          ],
        ] as [string, React.ReactNode][])
      : []),
  ];
  return (
    <>
      <div className="overflow-hidden rounded-lg border border-line">
        <table className="w-full border-collapse text-sm" aria-label={`Entry ${e.entryNo}: both sides`}>
          <thead className="bg-surface-2/60">
            <tr>
              <th scope="col" className="h-9 px-3 text-left text-xs font-medium text-muted">
                Account
              </th>
              <th scope="col" className="h-9 px-3 text-right text-xs font-medium text-muted">
                Debit
              </th>
              <th scope="col" className="h-9 px-3 text-right text-xs font-medium text-muted">
                Credit
              </th>
            </tr>
          </thead>
          <tbody>
            {e.rows.map((r) => {
              const v = (x: string, base: string) =>
                Number(x) || Number(base) ? (
                  <>
                    {single ? amount(Number(x)) : money(x, r.currency)}
                    {r.currency !== main && Number(base) > 0 && <span className="block text-xs text-muted">{money(base, main)}</span>}
                  </>
                ) : null;
              return (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-3 py-2.5">{r.accountLabel}</td>
                  <td className="px-3 py-2.5 text-right tabular">{v(r.debit, r.debitBase)}</td>
                  <td className="px-3 py-2.5 text-right tabular">{v(r.credit, r.creditBase)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-line bg-surface-2/40 text-xs text-text-2">
              <td className="px-3 py-2">In {main}: debits equal credits</td>
              <td className="px-3 py-2 text-right font-semibold tabular">{amount(Number(e.totals.debit))}</td>
              <td className="px-3 py-2 text-right font-semibold tabular">{amount(Number(e.totals.credit))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
        {details.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-text-2">{k}</dt>
            <dd className="min-w-0 [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
      </dl>
      {e.related.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">The document's other entries</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {e.related.map((r) => (
              <li key={r.groupId}>
                <Link href={`?panel=entry&id=${r.groupId}`} scroll={false} className="text-primary hover:underline">
                  Entry {r.entryNo} · {r.date}
                </Link>{" "}
                <span className="text-text-2">{r.reason ?? ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {src && (
          <Link href={src.href} className={buttonClass("secondary", "sm")}>
            {src.label}
          </Link>
        )}
        {receipt && (
          <Link href={receipt} className={buttonClass("ghost", "sm")}>
            Receipt PDF
          </Link>
        )}
      </div>
      <p className={cn("text-xs text-muted")}>
        Posted {dateTime(e.postedAt)}
        {e.postedBy ? ` by ${e.postedBy.name}` : " by the system"}. Ledger rows can&rsquo;t be edited: change or remove the{" "}
        {e.source.label ? "document" : "record"} itself, and the ledger posts a correction and keeps both.
      </p>
    </>
  );
}
