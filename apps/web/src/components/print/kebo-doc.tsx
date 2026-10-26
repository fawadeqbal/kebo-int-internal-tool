import type { CSSProperties, ReactNode } from "react";
import { numberToWords } from "@kebo/utils";
import type { CompanySnapshot, CustomerSnapshot } from "@/lib/types-orders";
import { countryName, isUnknownCountry } from "@/lib/countries";

/**
 * Every Kebo document — quotation, proforma invoice and packing list — in one layout, the one the team makes in Word
 * (PI_FOR_LIQUID_SYRUP_COMPLETE_LINE): centred letterhead in Times, the
 * customer on the left and the document details on the right, a table with a
 * light-blue header, the total in words, then the terms, the bank details and
 * the company stamp in one box.
 *
 * Each priced document has two copies:
 *  - the customer's: the items and quantities, and one total at the end;
 *  - the internal one (never sent): unit prices, amounts, costs and margin,
 *    and every payment, under a red "internal copy" band.
 *
 * Measured from that PDF (A4 = 595.6 × 842 pt): the table runs from x 14.2 to
 * 574.4 pt, the No. column is 28.5 pt wide, text sits 5.6 pt inside the cells.
 */

export const TIMES = "'Times New Roman', 'Liberation Serif', Tinos, Times, serif";
const ARIAL = "Arial, 'Liberation Sans', Arimo, Helvetica, sans-serif";
const SONG = "SimSun, 'Songti SC', 'Noto Serif CJK SC', 'Noto Serif CJK', serif";
const HEADER_BLUE = "#D9EAF7";
const LINE = "0.5pt solid #000";

/* ---------------------------------------------------------------- formatting, as on Kebo's documents */

/** "SEP 16, 2026" */
export function docDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][(m ?? 1) - 1];
  return `${month} ${d}, ${y}`;
}

const SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", CNY: "¥", JPY: "¥" };

/** "$ 90,000" (cents only when there are any). */
export function docMoney(amount: string | number, currency: string) {
  const n = Number(amount);
  const cents = Math.round(Math.abs(n) * 100) % 100 !== 0;
  const figure = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
  return `${n < 0 ? "- " : ""}${SYMBOL[currency] ?? currency} ${figure}`;
}

/** "USD Ninety Thousand only" */
export function docWords(amount: string, currency: string) {
  const cents = Math.round(Math.abs(Number(amount)) * 100);
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return `${currency} ${numberToWords(whole)}${rest ? ` and Cents ${numberToWords(rest)}` : ""} only`;
}

/** "1 Set", "2,000 pcs" */
export function docQty(quantity: string | number, unit?: string | null) {
  return `${Number(quantity).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${unit ?? ""}`.trim();
}

/** Free text (terms, notes) as bullets: one per line, without the "1." numbering people type. */
export function textBullets(text: string | null | undefined) {
  return (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, "").trim())
    .filter(Boolean);
}

/** "Port of loading" / "Port of discharge": the Incoterm place is where goods are loaded for E and F terms, where they go for C and D terms. */
export function portBullets(incoterm: string, place: string | null, portOfDischarge?: string | null): ReactNode[] {
  const loadingTerm = ["EXW", "FCA", "FAS", "FOB"].includes(incoterm);
  const loading = loadingTerm ? place : null;
  const discharge = portOfDischarge ?? (loadingTerm ? null : place);
  return [
    loading ? <Labelled key="pol" label="Port of loading:" gap="30pt" value={loading} /> : null,
    discharge ? <Labelled key="pod" label="Port of discharge:" gap="6pt" value={discharge} /> : null,
  ].filter(Boolean);
}

function Labelled({ label, value, gap = "6pt" }: { label: string; value: ReactNode; gap?: string }) {
  return (
    <>
      {label}
      <span style={{ display: "inline-block", width: gap }} />
      {value}
    </>
  );
}

/** A bullet with a label, e.g. "B/L No.: QDLOS-77". */
export const labelled = (label: string, value: ReactNode, gap?: string) => <Labelled label={label} value={value} gap={gap} />;

/* ---------------------------------------------------------------- the document */

export interface DocColumn<T> {
  label: string;
  /** Fixed width in pt; the description column takes the rest. */
  width?: number;
  align?: "left" | "right";
  /** Let a fixed-width column wrap (e.g. "2 Wooden boxes"). */
  wrap?: boolean;
  render: (row: T, index: number) => ReactNode;
}

const cell: CSSProperties = { border: LINE, padding: "1.4pt 5.6pt", verticalAlign: "middle", textAlign: "left" };

export function KeboDoc<T>({
  company,
  customer,
  title,
  numberLabel = "NO.",
  number,
  date,
  meta = [],
  heading,
  columns,
  rows,
  sums = [],
  total,
  foot,
  boxTitle = "Payment terms:",
  bullets,
  bank,
  internal,
  internalBand = "INTERNAL COPY — FOR KEBO ONLY, NOT FOR THE CUSTOMER",
  watermark,
}: {
  company: CompanySnapshot;
  customer: CustomerSnapshot;
  /** Spaced as in the Word documents: "PROFORMA  INVOICE". */
  title: string;
  numberLabel?: string;
  number: string;
  date: string;
  /** More rows under the number on the right, e.g. "Valid until". */
  meta?: { label: string; value: ReactNode }[];
  /** A heading row over the items, e.g. "COMPLETE AUTOMATIC LIQUID SYRUP FILLING LINE". */
  heading?: string | null;
  columns: DocColumn<T>[];
  rows: T[];
  /** Bold rows before the total (subtotal, discount, tax). */
  sums?: { label: string; value: string }[];
  /** "Total FOB Price : USD Ninety Thousand only   $ 90,000" */
  total?: { label: string; words: string; amount: string } | null;
  /** Rows after the items instead of a money total (the packing list). */
  foot?: ReactNode;
  boxTitle?: string;
  bullets: ReactNode[];
  bank?: string | null;
  /** The internal copy: a red band at the top and this section after the box. */
  internal?: ReactNode;
  internalBand?: string;
  watermark?: string | null;
}) {
  const address = customer.address?.trim() || (isUnknownCountry(customer.country) ? "" : countryName(customer.country));
  const widths = columns.map((c) => c.width);
  return (
    <article
      className="kebo-doc relative mx-auto bg-white text-black shadow-[0_1px_3px_rgba(16,24,40,.12),0_8px_24px_rgba(16,24,40,.08)] print:shadow-none"
      style={{
        width: "595.6pt",
        minHeight: "842pt",
        padding: "40pt 21.2pt 40pt 14.2pt",
        fontFamily: TIMES,
        fontSize: "10pt",
        lineHeight: 1.15,
      }}
    >
      {/* On paper the page margins come from @page (and the PDF route); the sheet only keeps the first-page offset. */}
      <style>{`@page { size: A4; margin: 40pt 21.2pt 40pt 14.2pt; }
@media print { .kebo-doc { width: auto !important; min-height: 0 !important; padding: 0 !important; } }
@media screen and (max-width: 820px) { .kebo-doc { zoom: 0.78; } }
@media screen and (max-width: 640px) { .kebo-doc { zoom: 0.58; } }
@media screen and (max-width: 480px) { .kebo-doc { zoom: 0.48; } }
@media screen and (max-width: 400px) { .kebo-doc { zoom: 0.43; } }
@media screen and (max-width: 360px) { .kebo-doc { zoom: 0.38; } }`}</style>
      {watermark && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <span className="-rotate-[30deg] border-[6px] border-[#dc2626]/25 px-10 text-[100pt] leading-none font-extrabold tracking-[0.08em] text-[#dc2626]/[0.13] select-none">
            {watermark}
          </span>
        </div>
      )}
      {internal && (
        <div
          style={{
            marginBottom: "8pt",
            background: "#B91C1C",
            color: "#fff",
            fontFamily: ARIAL,
            fontSize: "8.5pt",
            fontWeight: 700,
            letterSpacing: "0.06em",
            textAlign: "center",
            padding: "3pt 0",
            printColorAdjust: "exact",
            WebkitPrintColorAdjust: "exact",
          }}
        >
          {internalBand}
        </div>
      )}

      {/* Letterhead */}
      <header style={{ textAlign: "center", fontSize: "12pt", lineHeight: "18.1pt", paddingTop: internal ? "0" : "13.5pt" }}>
        {company.nameLocal && <div style={{ fontFamily: SONG, lineHeight: "15.5pt" }}>{company.nameLocal}</div>}
        <div>{company.name}</div>
        {company.address && <div>{company.address}</div>}
        {company.phone && <div style={{ marginTop: "6.2pt", whiteSpace: "pre" }}>Tel: {company.phone}</div>}
        <h1
          style={{
            margin: "2.3pt 0 0",
            fontSize: "18pt",
            lineHeight: "22pt",
            fontWeight: 400,
            textDecoration: "underline",
            textUnderlineOffset: "2.4pt",
            textDecorationThickness: "0.8pt",
            whiteSpace: "pre",
          }}
        >
          {title}
        </h1>
      </header>

      {/* Customer (left) and the document details (right) */}
      <section style={{ display: "flex", justifyContent: "space-between", gap: "12pt", marginTop: "18.8pt" }}>
        <div style={{ width: "214pt", fontFamily: ARIAL, fontSize: "11pt", lineHeight: "12.6pt" }}>
          <div>
            <span style={{ fontFamily: TIMES, fontSize: "12pt" }}>Customer: </span>
            {customer.name}
          </div>
          {address && <div style={{ marginTop: "2.3pt", whiteSpace: "pre-line" }}>Address: {address}</div>}
          {customer.taxNo && (
            <div style={{ marginTop: "1.9pt" }}>
              Business License Number: <b>{customer.taxNo}</b>
            </div>
          )}
          {customer.regNo && (
            <div style={{ marginTop: "2.1pt" }}>
              Reg. Number: <b>{customer.regNo}</b>
            </div>
          )}
        </div>
        <div style={{ width: "190pt", fontSize: "12pt", lineHeight: "14pt", paddingTop: "0.4pt" }}>
          <div>DATE: {docDate(date)}</div>
          <div style={{ marginTop: "0.7pt" }}>
            {numberLabel} <b>{number}</b>
          </div>
          {meta.map((m) => (
            <div key={m.label} style={{ marginTop: "0.7pt" }}>
              {m.label} {m.value}
            </div>
          ))}
          {company.taxNo && (
            <div style={{ fontFamily: ARIAL, fontSize: "11pt", lineHeight: "12.6pt", marginTop: "4.4pt", marginLeft: "-1.3pt" }}>
              Business License No:
              <br />
              <b>{company.taxNo}</b>
            </div>
          )}
          {company.website && (
            <div style={{ marginTop: "1.2pt" }}>
              <a
                href={`https://${company.website.replace(/^https?:\/\//, "")}`}
                style={{ color: "#0000FF", textDecoration: "underline", textDecorationThickness: "0.6pt" }}
              >
                {company.website}
              </a>
            </div>
          )}
          {company.email && <div style={{ marginTop: "-0.3pt" }}>Email:{company.email}</div>}
        </div>
      </section>

      {/* The items */}
      <table
        style={{
          width: "100%",
          marginTop: "13.6pt",
          borderCollapse: "collapse",
          tableLayout: "fixed",
          fontSize: "10pt",
          lineHeight: "11.5pt",
        }}
      >
        <colgroup>
          {widths.map((w, i) => (
            <col key={i} style={w ? { width: `${w}pt` } : undefined} />
          ))}
        </colgroup>
        <thead style={{ display: "table-header-group" }}>
          <tr style={{ background: HEADER_BLUE, fontWeight: 700, printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}>
            {columns.map((c) => (
              <th key={c.label} style={{ ...cell, paddingTop: 0, paddingBottom: 0, textAlign: c.align ?? "left" }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {heading && (
            <tr>
              <td style={cell} />
              <td
                colSpan={columns.length - 2}
                style={{
                  ...cell,
                  textAlign: "center",
                  fontWeight: 700,
                  fontSize: "12pt",
                  lineHeight: "13.9pt",
                  padding: 0,
                  textTransform: "uppercase",
                }}
              >
                {heading}
              </td>
              <td style={cell} />
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={i} style={{ breakInside: "avoid", height: "20.2pt" }}>
              {columns.map((c) => (
                <td key={c.label} style={{ ...cell, textAlign: c.align ?? "left", whiteSpace: c.width && !c.wrap ? "nowrap" : "pre-line" }}>
                  {c.render(r, i)}
                </td>
              ))}
            </tr>
          ))}
          {sums.map((s) => (
            <tr key={s.label}>
              <td colSpan={columns.length - 1} style={{ ...cell, fontWeight: 700 }}>
                {s.label}
              </td>
              <td style={{ ...cell, fontWeight: 700, whiteSpace: "nowrap", textAlign: columns.at(-1)?.align ?? "left" }}>{s.value}</td>
            </tr>
          ))}
          {total && (
            <tr style={{ fontWeight: 700, fontSize: "12pt", lineHeight: "13.8pt", breakInside: "avoid" }}>
              <td colSpan={columns.length - 1} style={{ ...cell, padding: "0 5.6pt" }}>
                <span style={{ display: "inline-block", minWidth: "133.7pt" }}>{total.label}</span>
                {total.words}
              </td>
              <td style={{ ...cell, padding: "0 5.1pt", whiteSpace: "nowrap", textAlign: columns.at(-1)?.align ?? "left" }}>
                {total.amount}
              </td>
            </tr>
          )}
          {foot}
        </tbody>
      </table>

      {/* Terms, bank details and the stamp, in one box under the table */}
      <section
        style={{
          position: "relative",
          border: LINE,
          borderTop: "none",
          minHeight: company.stamp ? "150pt" : undefined,
          padding: "15pt 5.6pt 24pt 5.6pt",
          boxDecorationBreak: "clone",
          WebkitBoxDecorationBreak: "clone",
        }}
      >
        <div style={{ breakInside: "avoid" }}>
          <div style={{ paddingLeft: "1.8pt" }}>{boxTitle}</div>
          <ul
            style={{
              margin: "0.3pt 0 0",
              paddingLeft: "22.4pt",
              listStyle: "none",
              lineHeight: "11.75pt",
              maxWidth: company.stamp ? "380pt" : undefined,
            }}
          >
            {bullets.map((b, i) => (
              <li key={i} style={{ position: "relative", paddingLeft: "15pt", whiteSpace: "pre-line" }}>
                <span aria-hidden style={{ position: "absolute", left: 0, fontFamily: "Symbol, 'Liberation Serif', serif" }}>
                  •
                </span>
                {b}
              </li>
            ))}
          </ul>
        </div>
        {bank && (
          <div style={{ marginTop: "23.4pt", lineHeight: "11.5pt", position: "relative", zIndex: 1, breakInside: "avoid" }}>
            <div style={{ fontWeight: 700 }}>BANK DETAILS:</div>
            <div style={{ marginTop: "11.2pt", whiteSpace: "pre-line" }}>{bank}</div>
          </div>
        )}
        {company.stamp && (
          // eslint-disable-next-line @next/next/no-img-element -- a data URL from Settings, printed as is
          <img
            src={company.stamp}
            alt="Company stamp"
            style={{
              position: "absolute",
              left: "412.9pt",
              top: "28.2pt",
              width: "112.8pt",
              height: "107.6pt",
              objectFit: "contain",
              mixBlendMode: "multiply",
            }}
          />
        )}
      </section>

      {internal && <section style={{ marginTop: "14pt", breakInside: "avoid" }}>{internal}</section>}
    </article>
  );
}

/* ---------------------------------------------------------------- the internal copy's extra sections */

/** A small bordered table in the documents' style, for the internal copy (money, payments, costing). */
export function InternalTable({ title, head, rows, note }: { title: string; head?: string[]; rows: ReactNode[][]; note?: ReactNode }) {
  const c: CSSProperties = { border: LINE, padding: "1.4pt 5.6pt", textAlign: "left", verticalAlign: "top" };
  return (
    <div style={{ marginTop: "10pt", breakInside: "avoid" }}>
      <div style={{ fontWeight: 700, color: "#B91C1C", marginBottom: "3pt" }}>{title}</div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10pt", lineHeight: "11.5pt" }}>
        {head && (
          <thead>
            <tr style={{ background: HEADER_BLUE, fontWeight: 700, printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}>
              {head.map((h, i) => (
                <th key={i} style={{ ...c, textAlign: i === head.length - 1 || i === 0 ? c.textAlign : "left" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j} style={c}>
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {note && <div style={{ marginTop: "3pt", fontSize: "9pt" }}>{note}</div>}
    </div>
  );
}

/** Margin on one line: (price − cost) / price. */
export function marginOf(unitPrice: string | number, unitCost: string | number | null | undefined) {
  if (unitCost === null || unitCost === undefined) return "";
  const p = Number(unitPrice);
  if (!(p > 0)) return "";
  return `${(Math.round(((p - Number(unitCost)) / p) * 1000) / 10).toFixed(1)}%`;
}
