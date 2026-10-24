import type { ReactNode } from "react";
import type { AppSettings } from "@/modules/settings/service";
import { formatDate } from "@/lib/utils/dates";
import { formatCents, formatMoney, toCents } from "@/lib/utils/money";
import { amountInWords } from "@/lib/utils/words";
import { cn } from "@/lib/utils/cn";

interface DocLine {
  description: string;
  model?: string | null;
  hsCode?: string | null;
  quantity: string;
  unit?: string | null;
  unitPrice: string;
  lineTotal: string;
}

/** "Model X · HS 8479.89" under the item name. */
export function lineCodes(it: { model?: string | null; hsCode?: string | null }) {
  return [it.model && `Model ${it.model}`, it.hsCode && `HS ${it.hsCode}`].filter(Boolean).join(" · ");
}

const qtyUnit = (it: DocLine) => `${Number(it.quantity)}${it.unit ? ` ${it.unit}` : ""}`;

export interface DocumentProps {
  kind: "Quotation" | "Invoice";
  number: string;
  /** Our letterhead and bank details (frozen on sent/issued documents). */
  settings: AppSettings;
  currency: string;
  customer: { companyName: string | null; contactPerson: string; phone: string; email: string | null; address: string | null; taxNo: string | null };
  /** Rows of the details box (date, validity, references…). */
  meta: { label: string; value: ReactNode }[];
  /** One line on what the document is for, e.g. the inquiry title. */
  subject?: string | null;
  items: DocLine[];
  totals: { subtotal: string; discount: string; taxRate: string; taxAmount: string; total: string; amountPaid?: string };
  terms?: string | null;
  /** Invoice only: how to pay. */
  payment?: { bankDetails: string; dueDate: string; paidInFull: boolean };
  /** Quotation only: bank details for the advance payment. */
  bankDetails?: string;
  footer?: string | null;
  /** Draft / Paid / Cancelled marking. */
  stamp?: { label: string; tone: "draft" | "paid" | "void" } | null;
}

const label = "text-[10px] font-semibold tracking-[0.12em] text-stone-500 uppercase";

/**
 * The printed quotation / invoice. One layout for the screen preview, the
 * print page and the PDF download (the PDF is this page printed by Chrome).
 * It reflows on a phone and is A4 when printed.
 */
export function DocumentView({ kind, number, settings, currency, customer, meta, subject, items, totals, terms, payment, bankDetails, footer, stamp }: DocumentProps) {
  const c = currency;
  const discount = toCents(totals.discount);
  const tax = toCents(totals.taxAmount);
  const paid = totals.amountPaid !== undefined ? toCents(totals.amountPaid) : 0;
  const balance = toCents(totals.total) - paid;
  const title = kind === "Invoice" ? "Invoice" : "Quotation";

  return (
    <article className="relative mx-auto w-full max-w-[210mm] bg-white px-5 py-6 text-[12.5px] leading-relaxed text-stone-800 [print-color-adjust:exact] sm:px-12 sm:py-11 print:p-0">
      <Watermark stamp={stamp} />

      <Letterhead settings={settings} title={title} number={number} stamp={stamp} />

      {/* Parties and details */}
      <section className="mt-6 grid gap-4 sm:grid-cols-[1.15fr_1fr]">
        <PartyBox title={kind === "Invoice" ? "Bill to" : "Prepared for"} customer={customer} />
        <DetailsBox title={`${title} details`} rows={meta} />
      </section>

      {subject && (
        <p className="mt-5">
          <span className="font-semibold text-stone-900">Subject:</span> {subject}
        </p>
      )}

      {/* Line items: a table on paper and wide screens, stacked on a phone */}
      <table className="mt-4 hidden w-full border-collapse sm:table">
        <thead>
          <tr className="bg-stone-900 text-left text-[10px] tracking-[0.1em] text-white uppercase">
            <th className="w-10 py-2.5 pl-3 font-semibold">No.</th>
            <th className="py-2.5 pr-3 font-semibold">Description</th>
            <th className="w-20 py-2.5 pr-3 text-right font-semibold">Qty</th>
            <th className="w-32 py-2.5 pr-3 text-right font-semibold">Unit price</th>
            <th className="w-36 py-2.5 pr-3 text-right font-semibold">Amount ({c})</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => {
            const [name, ...rest] = it.description.split("\n");
            return (
              <tr key={i} className="border-b border-stone-200 align-top">
                <td className="py-3 pl-3 text-stone-500 tabular-nums">{i + 1}</td>
                <td className="py-3 pr-3">
                  <p className="font-medium text-stone-900">{name}</p>
                  {lineCodes(it) && <p className="mt-0.5 text-[11px] text-stone-500">{lineCodes(it)}</p>}
                  {rest.length > 0 && <p className="mt-0.5 whitespace-pre-wrap text-stone-600">{rest.join("\n")}</p>}
                </td>
                <td className="py-3 pr-3 text-right whitespace-nowrap tabular-nums">{qtyUnit(it)}</td>
                <td className="py-3 pr-3 text-right tabular-nums">{formatMoney(it.unitPrice, c)}</td>
                <td className="py-3 pr-3 text-right font-medium text-stone-900 tabular-nums">{formatMoney(it.lineTotal, c)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ol className="mt-4 divide-y divide-stone-200 border-y border-stone-900 sm:hidden">
        {items.map((it, i) => {
          const [name, ...rest] = it.description.split("\n");
          return (
            <li key={i} className="py-3">
              <div className="flex justify-between gap-3">
                <p className="font-medium text-stone-900">
                  <span className="mr-1.5 text-stone-400 tabular-nums">{i + 1}.</span>
                  {name}
                </p>
                <p className="shrink-0 font-medium text-stone-900 tabular-nums">{formatMoney(it.lineTotal, c)}</p>
              </div>
              {lineCodes(it) && <p className="mt-0.5 text-[11px] text-stone-500">{lineCodes(it)}</p>}
              {rest.length > 0 && <p className="mt-0.5 whitespace-pre-wrap text-stone-600">{rest.join("\n")}</p>}
              <p className="mt-1 text-stone-500 tabular-nums">
                {qtyUnit(it)} × {formatMoney(it.unitPrice, c)}
              </p>
            </li>
          );
        })}
      </ol>

      {/* Amount in words + totals */}
      <section className="mt-4 grid gap-5 sm:grid-cols-[1fr_17rem] sm:items-start">
        <div className="order-2 sm:order-1">
          <p className={label}>Amount in words</p>
          <p className="mt-1 font-medium text-stone-900 italic">{amountInWords(toCents(totals.total), c)}</p>
        </div>
        <dl className="order-1 space-y-1.5 sm:order-2">
          <div className="flex justify-between gap-4">
            <dt className="text-stone-500">Subtotal</dt>
            <dd className="tabular-nums">{formatMoney(totals.subtotal, c)}</dd>
          </div>
          {discount > 0 && (
            <div className="flex justify-between gap-4">
              <dt className="text-stone-500">Discount</dt>
              <dd className="tabular-nums">− {formatMoney(totals.discount, c)}</dd>
            </div>
          )}
          {(tax > 0 || Number(totals.taxRate) > 0) && (
            <div className="flex justify-between gap-4">
              <dt className="text-stone-500">Tax ({Number(totals.taxRate)}%)</dt>
              <dd className="tabular-nums">{formatMoney(totals.taxAmount, c)}</dd>
            </div>
          )}
          <div className="!mt-2.5 flex items-baseline justify-between gap-4 rounded-md bg-stone-900 px-3 py-2.5 text-white">
            <dt className="text-[11px] font-semibold tracking-[0.12em] uppercase">Total {c}</dt>
            <dd className="text-[15px] font-bold tabular-nums">{formatMoney(totals.total, c)}</dd>
          </div>
          {kind === "Invoice" && paid > 0 && (
            <>
              <div className="flex justify-between gap-4 px-3 pt-1">
                <dt className="text-stone-500">Received</dt>
                <dd className="tabular-nums">− {formatMoney(totals.amountPaid, c)}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-stone-300 px-3 pt-1.5 font-semibold text-stone-900">
                <dt>Balance due</dt>
                <dd className="tabular-nums">{formatCents(balance, c)}</dd>
              </div>
            </>
          )}
        </dl>
      </section>

      {/* Payment instructions (invoice) */}
      {payment && (
        <section className="mt-6 grid gap-4 rounded-md border border-stone-200 p-4 break-inside-avoid sm:grid-cols-[1fr_auto]">
          <div>
            <p className={label}>Payment by bank transfer (T/T)</p>
            {payment.bankDetails ? (
              <p className="mt-1.5 whitespace-pre-line text-stone-800">{payment.bankDetails}</p>
            ) : (
              <p className="mt-1.5 text-stone-500">Bank details will be sent separately.</p>
            )}
            <p className="mt-2 text-stone-600">
              Please quote <span className="font-mono font-semibold text-stone-900">{number}</span> as the payment reference. Bank charges are borne by the remitter.
            </p>
          </div>
          <div className="flex flex-col justify-between gap-6 sm:w-60 sm:border-l sm:border-stone-200 sm:pl-5">
            <div>
              <p className={label}>{payment.paidInFull ? "Status" : "Payment due"}</p>
              <p className="mt-1.5 text-[14px] font-semibold text-stone-900">{payment.paidInFull ? "Paid in full" : formatDate(payment.dueDate)}</p>
            </div>
            <div>
              <p className={label}>For and on behalf of</p>
              <p className="mt-0.5 leading-snug font-medium text-stone-900">{settings.companyName}</p>
              <div className="mt-8 border-t border-stone-400 pt-1.5 text-[11px] text-stone-500">Authorised signature</div>
            </div>
          </div>
        </section>
      )}

      {/* Terms, with the bank details beside them on a quotation */}
      {(terms || (!payment && bankDetails)) && (
        <section className={cn("mt-6 grid gap-5 break-inside-avoid", !payment && bankDetails && terms && "sm:grid-cols-2")}>
          {!payment && bankDetails && (
            <div className="rounded-md border border-stone-200 p-3.5">
              <p className={label}>Bank details for payment (T/T)</p>
              <p className="mt-1 whitespace-pre-line text-stone-800">{bankDetails}</p>
              <p className="mt-1.5 text-stone-600">
                Reference: <span className="font-mono font-semibold text-stone-900">{number}</span>
              </p>
            </div>
          )}
          {terms && (
            <div>
              <p className={label}>Terms & conditions</p>
              <p className="mt-1.5 whitespace-pre-wrap text-stone-700">{terms}</p>
            </div>
          )}
        </section>
      )}

      {/* Signatures (an invoice signs inside the payment box) */}
      {!payment && (
        <section className={cn("mt-6 grid gap-8 break-inside-avoid", kind === "Quotation" && "sm:grid-cols-2")}>
          {kind === "Quotation" && (
            <div>
              <p className={label}>Accepted by the customer</p>
              <div className="mt-10 border-t border-stone-400 pt-1.5 text-[11px] text-stone-500">Name, signature, company stamp and date</div>
            </div>
          )}
          <div className={cn(kind === "Invoice" && "sm:ml-auto sm:w-72")}>
            <p className={label}>For and on behalf of</p>
            <p className="mt-0.5 font-medium text-stone-900">{settings.companyName}</p>
            <div className="mt-8 border-t border-stone-400 pt-1.5 text-[11px] text-stone-500">Authorised signature</div>
          </div>
        </section>
      )}

      {footer && <footer className="mt-6 border-t border-stone-200 pt-3 text-center text-[11px] font-medium text-stone-700">{footer}</footer>}
    </article>
  );
}

export const docDate = (iso: string | null | undefined) => formatDate(iso);

type Stamp = { label: string; tone: "draft" | "paid" | "void" } | null | undefined;

/** Faint diagonal word behind a draft or cancelled document. */
export function Watermark({ stamp }: { stamp: Stamp }) {
  if (!stamp || stamp.tone === "paid") return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
      <span className="-rotate-[28deg] text-[110px] font-bold tracking-[0.15em] text-stone-900/[0.04] uppercase select-none">{stamp.label}</span>
    </div>
  );
}

/** Company letterhead with the document title and number (shared by every printed document). */
export function Letterhead({ settings, title, number, stamp }: { settings: AppSettings; title: string; number: string; stamp?: Stamp }) {
  const contact = [settings.companyPhone, settings.companyEmail, settings.companyWebsite].filter(Boolean);
  return (
    <>
      <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-md bg-stone-900 text-white" aria-hidden>
            <svg viewBox="0 0 32 32" className="size-5">
              <path d="M8 10h16M8 16h11M8 22h7" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="text-[15px] leading-tight font-bold tracking-tight text-stone-900">{settings.companyName}</p>
            {settings.companyAddress && <p className="mt-1 whitespace-pre-line text-stone-600">{settings.companyAddress}</p>}
            {contact.length > 0 && <p className="text-stone-600">{contact.join("  ·  ")}</p>}
            {settings.companyTaxNo && <p className="text-stone-600">Tax / Reg. no. {settings.companyTaxNo}</p>}
          </div>
        </div>
        <div className="sm:text-right">
          <p className="text-[26px] leading-none font-light tracking-[0.22em] text-stone-900 uppercase">{title}</p>
          <p className="mt-2 font-mono text-[13px] font-semibold text-stone-900">No. {number}</p>
          {stamp && (
            <p
              className={cn(
                "mt-2 inline-block rounded border px-2 py-0.5 text-[10px] font-bold tracking-[0.15em] uppercase",
                stamp.tone === "paid" && "border-emerald-600 text-emerald-700",
                stamp.tone === "draft" && "border-stone-400 text-stone-500",
                stamp.tone === "void" && "border-red-600 text-red-600",
              )}
            >
              {stamp.label}
            </p>
          )}
        </div>
      </header>
      <div className="mt-6 h-[3px] bg-stone-900" />
    </>
  );
}

type Party = { companyName: string | null; contactPerson: string; phone: string; email: string | null; address: string | null; taxNo: string | null };

/** A customer (or consignee) box. */
export function PartyBox({ title, customer }: { title: string; customer: Party }) {
  return (
    <div className="rounded-md border border-stone-200 p-4">
      <p className={label}>{title}</p>
      <p className="mt-1.5 text-[13.5px] font-semibold text-stone-900">{customer.companyName || customer.contactPerson}</p>
      {customer.companyName && <p>Attn: {customer.contactPerson}</p>}
      {customer.address && <p className="whitespace-pre-line text-stone-600">{customer.address}</p>}
      <p className="text-stone-600">{customer.phone}</p>
      {customer.email && <p className="break-all text-stone-600">{customer.email}</p>}
      {customer.taxNo && <p className="text-stone-600">Tax / Reg. no. {customer.taxNo}</p>}
    </div>
  );
}

/** The grey label/value box (dates, references, shipment details). */
export function DetailsBox({ title, rows }: { title: string; rows: { label: string; value: ReactNode }[] }) {
  return (
    <div className="rounded-md border border-stone-200 bg-stone-50 p-4">
      <p className={label}>{title}</p>
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {rows.map((m) => (
          <div key={m.label} className="contents">
            <dt className="text-stone-500">{m.label}</dt>
            <dd className="text-right font-medium text-stone-900">{m.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export const docLabel = label;
