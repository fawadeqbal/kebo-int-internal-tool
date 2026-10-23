import type { AppSettings } from "@/modules/settings/service";
import { formatDate } from "@/lib/utils/dates";
import { formatMoney } from "@/lib/utils/money";

interface DocLine {
  description: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}

/** Printable quotation / invoice layout, shared by the screen preview and the print page. */
export function DocumentView({
  kind,
  number,
  settings,
  customer,
  meta,
  items,
  totals,
  terms,
  footer,
  stamp,
}: {
  kind: "Quotation" | "Invoice";
  number: string;
  settings: AppSettings;
  customer: { companyName: string; contactPerson: string; phone: string; email: string | null; address: string | null; taxNo: string | null };
  meta: { label: string; value: string }[];
  items: DocLine[];
  totals: { subtotal: string; discount: string; taxRate: string; taxAmount: string; total: string; amountPaid?: string };
  terms?: string | null;
  footer?: string | null;
  stamp?: string | null;
}) {
  const c = settings.currency;
  const hasDiscount = Number(totals.discount) > 0;
  const balance = totals.amountPaid !== undefined ? Number(totals.total) - Number(totals.amountPaid) : null;
  return (
    <article className="relative mx-auto w-full max-w-[210mm] bg-white p-8 text-[13px] leading-relaxed text-stone-900 sm:p-12 print:p-0">
      {stamp && (
        <div className="pointer-events-none absolute right-10 top-36 rotate-[-12deg] rounded-md border-4 border-current px-4 py-1 text-2xl font-bold uppercase tracking-widest text-red-600/40" aria-hidden>
          {stamp}
        </div>
      )}
      <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-stone-900 pb-6">
        <div>
          <p className="text-lg font-bold tracking-tight">{settings.companyName}</p>
          {settings.companyAddress && <p className="whitespace-pre-line text-stone-600">{settings.companyAddress}</p>}
          <p className="text-stone-600">{[settings.companyPhone, settings.companyEmail].filter(Boolean).join(" · ")}</p>
          {settings.companyTaxNo && <p className="text-stone-600">NTN: {settings.companyTaxNo}</p>}
        </div>
        <div className="text-right">
          <p className="text-2xl font-light uppercase tracking-[0.2em] text-stone-500">{kind}</p>
          <p className="mt-1 font-mono text-base font-semibold">{number}</p>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-6 py-6 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-stone-500">{kind === "Invoice" ? "Bill to" : "Prepared for"}</p>
          <p className="font-semibold">{customer.companyName}</p>
          <p>Attn: {customer.contactPerson}</p>
          {customer.address && <p className="text-stone-600">{customer.address}</p>}
          <p className="text-stone-600">{[customer.phone, customer.email].filter(Boolean).join(" · ")}</p>
          {customer.taxNo && <p className="text-stone-600">NTN: {customer.taxNo}</p>}
        </div>
        <dl className="grid grid-cols-[auto_1fr] content-start gap-x-6 gap-y-1 sm:justify-self-end">
          {meta.map((m) => (
            <div key={m.label} className="contents">
              <dt className="text-stone-500">{m.label}</dt>
              <dd className="text-right font-medium">{m.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y border-stone-300 bg-stone-50 text-left text-[11px] uppercase tracking-wider text-stone-500">
            <th className="w-8 py-2 pl-2">#</th>
            <th className="py-2">Description</th>
            <th className="w-16 py-2 text-right">Qty</th>
            <th className="w-32 py-2 text-right">Unit price</th>
            <th className="w-36 py-2 pr-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i} className="border-b border-stone-200 align-top">
              <td className="py-2.5 pl-2 text-stone-500">{i + 1}</td>
              <td className="whitespace-pre-wrap py-2.5 pr-4">{it.description}</td>
              <td className="py-2.5 text-right tabular-nums">{Number(it.quantity)}</td>
              <td className="py-2.5 text-right tabular-nums">{formatMoney(it.unitPrice, c)}</td>
              <td className="py-2.5 pr-2 text-right tabular-nums">{formatMoney(it.lineTotal, c)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-4 flex justify-end">
        <dl className="w-full max-w-xs space-y-1.5">
          <div className="flex justify-between">
            <dt className="text-stone-500">Subtotal</dt>
            <dd className="tabular-nums">{formatMoney(totals.subtotal, c)}</dd>
          </div>
          {hasDiscount && (
            <div className="flex justify-between">
              <dt className="text-stone-500">Discount</dt>
              <dd className="tabular-nums">− {formatMoney(totals.discount, c)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-stone-500">Tax ({Number(totals.taxRate)}%)</dt>
            <dd className="tabular-nums">{formatMoney(totals.taxAmount, c)}</dd>
          </div>
          <div className="flex justify-between border-t-2 border-stone-900 pt-2 text-base font-bold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatMoney(totals.total, c)}</dd>
          </div>
          {balance !== null && Number(totals.amountPaid) > 0 && (
            <>
              <div className="flex justify-between">
                <dt className="text-stone-500">Paid</dt>
                <dd className="tabular-nums">− {formatMoney(totals.amountPaid, c)}</dd>
              </div>
              <div className="flex justify-between font-semibold">
                <dt>Balance due</dt>
                <dd className="tabular-nums">{formatMoney(balance, c)}</dd>
              </div>
            </>
          )}
        </dl>
      </section>

      {terms && (
        <section className="mt-10 border-t border-stone-200 pt-4">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-stone-500">Terms & conditions</p>
          <p className="whitespace-pre-wrap text-stone-700">{terms}</p>
        </section>
      )}
      <footer className="mt-12 flex items-end justify-between gap-6 text-stone-500">
        <p>{footer}</p>
        <div className="w-48 border-t border-stone-400 pt-1 text-center text-[11px]">Authorised signature</div>
      </footer>
    </article>
  );
}

export const docDate = (iso: string | null | undefined) => formatDate(iso);
