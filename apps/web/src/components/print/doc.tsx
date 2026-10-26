import type { ReactNode } from "react";
import { cn } from "@kebo/ui";
import type { CompanySnapshot } from "@/lib/types-orders";

/**
 * The building blocks of the printed sales report (the customer documents use
 * kebo-doc.tsx): an A4 sheet on white
 * paper in the keboint.com brand, with the letterhead from the document's
 * company snapshot. Always light, whatever the app theme.
 */

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

