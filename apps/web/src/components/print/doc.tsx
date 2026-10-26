import type { ReactNode } from "react";
import { toMinor } from "@kebo/money";
import { amountInWords } from "@kebo/utils";
import { cn } from "@kebo/ui";
import { money, qty } from "@/lib/format";
import type { CompanySnapshot, CustomerSnapshot } from "@/lib/types-orders";

/**
 * The building blocks of Kebo's printed documents (quotation, proforma and
 * commercial invoices, packing list, report): an A4 sheet on white
 * paper in the keboint.com brand, with the letterhead from the document's
 * company snapshot. Always light, whatever the app theme.
 */

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
export const countryName = (code: string | null | undefined) => {
  if (!code || code === "ZZ") return "";
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
};

/** One A4 page (more when it flows over), with a watermark for drafts and void documents. */
export function Sheet({ watermark, children }: { watermark?: string | null; children: ReactNode }) {
  return (
    <article className="relative mx-auto w-[210mm] max-w-full min-h-[297mm] overflow-hidden bg-white px-[14mm] pt-[12mm] pb-[14mm] font-doc text-[9.5pt] leading-snug text-kebo-ink shadow-[0_1px_3px_rgba(16,24,40,.12),0_8px_24px_rgba(16,24,40,.08)] print:min-h-0 print:w-auto print:overflow-visible print:p-0 print:shadow-none">
      {watermark && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center print:fixed">
          <span className="-rotate-[30deg] rounded-xl border-[6px] border-[#dc2626]/25 px-10 font-doc-display text-[110pt] leading-none font-extrabold tracking-[0.08em] text-[#dc2626]/[0.13] select-none">
            {watermark}
          </span>
        </div>
      )}
      <div className="relative">{children}</div>
    </article>
  );
}

/** Company letterhead on the left, the document's name, number and dates on the right. */
export function Letterhead({
  company,
  title,
  number,
  meta,
}: {
  company: CompanySnapshot;
  title: string;
  number: ReactNode;
  meta: { label: string; value: ReactNode }[];
}) {
  const contact = [company.phone && `Tel ${company.phone}`, company.email, company.website].filter(Boolean).join("  ·  ");
  return (
    <header className="flex items-start justify-between gap-8 border-b-[2.5px] border-kebo pb-4">
      <div className="flex min-w-0 gap-3">
        <img src="/brand/kebo-logo.png" alt="" width={52} height={52} className="size-[52px] shrink-0 object-contain" />
        <div className="min-w-0">
          <p className="font-doc-display text-[13pt] leading-tight font-bold text-kebo-deep">{company.name}</p>
          {company.nameLocal && <p className="text-[9pt] text-[#475569]">{company.nameLocal}</p>}
          {company.address && <p className="mt-1 text-[8pt] whitespace-pre-line text-[#475569]">{company.address}</p>}
          {contact && <p className="text-[8pt] text-[#475569]">{contact}</p>}
          {company.taxNo && <p className="text-[8pt] text-[#475569]">Tax ID {company.taxNo}</p>}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <h1 className="font-doc-display text-[17pt] leading-none font-extrabold tracking-wide text-kebo uppercase">{title}</h1>
        <p className="mt-1.5 text-[10.5pt] font-semibold">{number}</p>
        <dl className="mt-1.5 grid grid-cols-[auto_auto] justify-end gap-x-3 gap-y-0.5 text-[8.5pt]">
          {meta.map((m) => (
            <div key={m.label} className="contents">
              <dt className="text-[#64748b]">{m.label}</dt>
              <dd className="font-medium">{m.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </header>
  );
}

function Box({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-md border border-kebo-line", className)}>
      <h2 className="rounded-t-md bg-kebo-light px-3 py-1 text-[7.5pt] font-semibold tracking-[0.08em] text-kebo-deep uppercase">
        {title}
      </h2>
      <div className="px-3 py-2">{children}</div>
    </section>
  );
}

/** The party the document is for (customer or factory). */
export function PartyBox({ title, party }: { title: string; party: { name: string; lines: (string | null | undefined)[] } }) {
  return (
    <Box title={title}>
      <p className="text-[10pt] font-semibold">{party.name}</p>
      {party.lines.filter(Boolean).map((l, i) => (
        <p key={i} className="whitespace-pre-line text-[#334155]">
          {l}
        </p>
      ))}
    </Box>
  );
}

export const customerLines = (c: CustomerSnapshot) => ({
  name: c.name,
  lines: [
    c.address,
    countryName(c.country),
    c.taxNo && `Tax ID ${c.taxNo}`,
    c.contact && `Attn: ${[c.contact.name, c.contact.phone, c.contact.email].filter(Boolean).join(" · ")}`,
  ],
});

/** Label/value pairs in a box (terms, shipping details…). */
export function FactsBox({
  title,
  items,
  className,
}: {
  title: string;
  items: { label: string; value: ReactNode | null | undefined }[];
  className?: string;
}) {
  return (
    <Box title={title} className={className}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {items
          .filter((i) => i.value !== null && i.value !== undefined && i.value !== "")
          .map((i) => (
            <div key={i.label} className="contents">
              <dt className="text-[#64748b]">{i.label}</dt>
              <dd className="font-medium">{i.value}</dd>
            </div>
          ))}
      </dl>
    </Box>
  );
}

export function Columns({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) {
  return <div className={cn("mt-4 grid gap-3", cols === 3 ? "grid-cols-3" : "grid-cols-2")}>{children}</div>;
}

export interface Column<T> {
  label: string;
  className?: string;
  render: (row: T, index: number) => ReactNode;
}

/** The lines of a document. `foot` rows (totals of a packing list) go under them. */
export function LinesTable<T>({ rows, columns, foot }: { rows: T[]; columns: Column<T>[]; foot?: ReactNode }) {
  return (
    <table className="mt-5 w-full border-collapse text-[9pt]">
      <thead>
        <tr className="bg-kebo-deep text-white">
          {columns.map((c) => (
            <th
              key={c.label}
              className={cn(
                "px-2 py-1.5 text-left text-[7.5pt] font-semibold tracking-[0.06em] uppercase first:rounded-tl-md last:rounded-tr-md",
                c.className,
              )}
            >
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-kebo-line align-top even:bg-kebo-paper">
            {columns.map((c) => (
              <td key={c.label} className={cn("px-2 py-1.5", c.className)}>
                {c.render(r, i)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {foot && <tfoot>{foot}</tfoot>}
    </table>
  );
}

/** Description with model and HS code under it. */
export function Describe({ description, model, hsCode }: { description: string; model?: string | null; hsCode?: string | null }) {
  return (
    <>
      <span className="font-medium whitespace-pre-line">{description}</span>
      {(model || hsCode) && (
        <span className="block text-[8pt] text-[#64748b]">
          {[model && `Model ${model}`, hsCode && `HS ${hsCode}`].filter(Boolean).join(" · ")}
        </span>
      )}
    </>
  );
}

export const num = (v: string | number) => <span className="tabular">{qty(v)}</span>;

/** Subtotal, discount, VAT… and the total, with the total in words. */
export function Totals({
  rows,
  total,
  currency,
  totalLabel = "Total",
  extra,
}: {
  rows: { label: string; value: string | null }[];
  total: string;
  currency: string;
  totalLabel?: string;
  extra?: ReactNode;
}) {
  return (
    <div className="mt-3 flex items-start justify-between gap-6 break-inside-avoid">
      <div className="min-w-0 flex-1 rounded-md bg-kebo-paper px-3 py-2 text-[8.5pt]">
        <span className="text-[#64748b]">Amount in words: </span>
        <span className="font-medium">{amountInWords(toMinor(total), currency)}</span>
      </div>
      <div className="w-[78mm] shrink-0">
        <dl className="text-[9pt]">
          {rows
            .filter((r) => r.value !== null)
            .map((r) => (
              <div key={r.label} className="flex justify-between gap-4 border-b border-kebo-line px-2 py-1">
                <dt className="text-[#475569]">{r.label}</dt>
                <dd className="tabular">{r.value}</dd>
              </div>
            ))}
          <div className="mt-1 flex justify-between gap-4 rounded-md bg-kebo px-2 py-1.5 text-[10.5pt] font-bold text-white">
            <dt>{totalLabel}</dt>
            <dd className="tabular">{money(total, currency)}</dd>
          </div>
        </dl>
        {extra}
      </div>
    </div>
  );
}

/** A titled block of free text (terms, notes, bank details, marks). */
export function TextBlock({
  title,
  children,
  mono,
  className,
}: {
  title: string;
  children: ReactNode;
  mono?: boolean;
  className?: string;
}) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <section className={cn("mt-4 break-inside-avoid", className)}>
      <h2 className="mb-1 text-[7.5pt] font-semibold tracking-[0.08em] text-kebo-deep uppercase">{title}</h2>
      <div className={cn("whitespace-pre-line text-[#334155]", mono && "font-mono text-[8.5pt]")}>{children}</div>
    </section>
  );
}

/** Signature lines and the footer text. */
export function SignOff({ left, right, footer }: { left: string; right?: string; footer?: string | null }) {
  return (
    <footer className="mt-8 break-inside-avoid">
      <div className="grid grid-cols-2 gap-10">
        <div>
          <div className="h-14" />
          <p className="border-t border-[#94a3b8] pt-1 text-[8pt] text-[#475569]">{left}</p>
        </div>
        {right ? (
          <div>
            <div className="h-14" />
            <p className="border-t border-[#94a3b8] pt-1 text-[8pt] text-[#475569]">{right}</p>
          </div>
        ) : (
          <div />
        )}
      </div>
      {footer && <p className="mt-6 border-t border-kebo-line pt-2 text-center text-[8pt] text-[#64748b]">{footer}</p>}
    </footer>
  );
}
