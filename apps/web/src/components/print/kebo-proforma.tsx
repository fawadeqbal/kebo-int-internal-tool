import type { CSSProperties, ReactNode } from "react";
import { numberToWords } from "@kebo/utils";
import type { OrderDocument } from "@/lib/types-orders";
import { countryName } from "@/lib/countries";

/**
 * Kebo's proforma invoice, laid out exactly like the one the team makes in Word
 * (PI_FOR_LIQUID_SYRUP_COMPLETE_LINE): centred letterhead in Times, the customer
 * on the left and the invoice details on the right, a No. / Description / Qty.
 * table with a light-blue header, the total in words, then the payment terms,
 * the bank details and the company stamp in one box.
 *
 * Measured from that PDF (A4 = 595.6 × 842 pt): the table runs from x 14.2 to
 * 574.4 pt (columns 28.5 / 460.3 / 71.4 pt), text sits 5.6 pt inside the cells.
 */

const TIMES = "'Times New Roman', 'Liberation Serif', Tinos, Times, serif";
const ARIAL = "Arial, 'Liberation Sans', Arimo, Helvetica, sans-serif";
const SONG = "SimSun, 'Songti SC', 'Noto Serif CJK SC', 'Noto Serif CJK', serif";
const HEADER_BLUE = "#D9EAF7";
const LINE = "0.5pt solid #000";

/** "SEP 16, 2026" */
function piDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][(m ?? 1) - 1];
  return `${month} ${d}, ${y}`;
}

const SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", CNY: "¥", JPY: "¥" };

/** "$ 90,000" (cents only when there are any). */
function piMoney(amount: string, currency: string) {
  const n = Number(amount);
  const whole = Number.isInteger(Math.round(n * 100) / 100) && Math.round(n * 100) % 100 === 0;
  const figure = n.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  return `${SYMBOL[currency] ?? currency} ${figure}`;
}

/** "USD Ninety Thousand only" */
function piWords(amount: string, currency: string) {
  const cents = Math.round(Math.abs(Number(amount)) * 100);
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return `${currency} ${numberToWords(whole)}${rest ? ` and Cents ${numberToWords(rest)}` : ""} only`;
}

/** "1 Set", "2,000 pcs" */
function piQty(quantity: string, unit: string) {
  return `${Number(quantity).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${unit}`.trim();
}

/** The terms text as bullets: one per line, without the "1." numbering people type. */
function termLines(terms: string | null | undefined) {
  return (terms ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, "").trim())
    .filter(Boolean);
}

const cell: CSSProperties = { border: LINE, padding: "1.4pt 5.6pt 1.4pt 5.6pt", verticalAlign: "middle", textAlign: "left" };

export function KeboProforma({ doc, customerCountry }: { doc: OrderDocument; customerCountry?: string | null }) {
  const { company: co, customer, order: o, totals: t, currency } = doc;
  const cancelled = o.status === "cancelled";
  const address = [customer.address?.trim(), !customer.address?.trim() && customerCountry ? countryName(customerCountry) : null].filter(Boolean).join("\n");
  // The Incoterm place is where the goods are loaded for EXW/FCA/FAS/FOB, and where they go for the C and D terms.
  const placeIsLoading = ["EXW", "FCA", "FAS", "FOB"].includes(o.incoterm);
  const loading = placeIsLoading ? o.incotermPlace : null;
  const discharge = o.portOfDischarge ?? (placeIsLoading ? null : o.incotermPlace);
  const bullets: ReactNode[] = [
    doc.paymentSentence,
    o.leadTime ? `Delivery: ${o.leadTime}` : null,
    ...termLines(doc.terms),
    loading ? (
      <>
        Port of loading:<span style={{ display: "inline-block", width: "30pt" }} />
        {loading}
      </>
    ) : null,
    discharge ? (
      <>
        Port of discharge:<span style={{ display: "inline-block", width: "6pt" }} />
        {discharge}
      </>
    ) : null,
  ].filter(Boolean);
  const extraRows = t
    ? [
        Number(t.discount) || t.vatRate > 0 ? { label: "Subtotal", value: piMoney(t.subtotal, currency) } : null,
        Number(t.discount) ? { label: "Discount", value: `- ${piMoney(t.discount, currency)}` } : null,
        t.vatRate > 0 ? { label: `Tax ${t.vatRate}%${t.pricesIncludeVat ? " (included)" : ""}`, value: piMoney(t.vat, currency) } : null,
      ].filter((r): r is { label: string; value: string } => r !== null)
    : [];

  return (
    <article
      className="kebo-pi relative mx-auto bg-white text-black shadow-[0_1px_3px_rgba(16,24,40,.12),0_8px_24px_rgba(16,24,40,.08)] print:shadow-none"
      style={{ width: "595.6pt", minHeight: "842pt", padding: "40pt 21.2pt 40pt 14.2pt", fontFamily: TIMES, fontSize: "10pt", lineHeight: 1.15 }}
    >
      {/* On paper the page margins come from @page (and the PDF route); the sheet only keeps the first-page offset. */}
      <style>{`@page { size: A4; margin: 40pt 21.2pt 40pt 14.2pt; }
@media print { .kebo-pi { width: auto !important; min-height: 0 !important; padding: 0 !important; } }
@media screen and (max-width: 820px) { .kebo-pi { zoom: 0.78; } }
@media screen and (max-width: 640px) { .kebo-pi { zoom: 0.58; } }
@media screen and (max-width: 480px) { .kebo-pi { zoom: 0.48; } }
@media screen and (max-width: 400px) { .kebo-pi { zoom: 0.43; } }
@media screen and (max-width: 360px) { .kebo-pi { zoom: 0.38; } }`}</style>
      {cancelled && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <span className="-rotate-[30deg] border-[6px] border-[#dc2626]/25 px-10 text-[100pt] leading-none font-extrabold tracking-[0.08em] text-[#dc2626]/[0.13] select-none">CANCELLED</span>
        </div>
      )}

      {/* Letterhead */}
      <header style={{ textAlign: "center", fontSize: "12pt", lineHeight: "18.1pt", paddingTop: "13.5pt" }}>
        {co.nameLocal && <div style={{ fontFamily: SONG, lineHeight: "15.5pt" }}>{co.nameLocal}</div>}
        <div>{co.name}</div>
        {co.address && <div>{co.address}</div>}
        {co.phone && <div style={{ marginTop: "6.2pt", whiteSpace: "pre" }}>Tel: {co.phone}</div>}
        <h1 style={{ margin: "2.3pt 0 0", fontSize: "18pt", lineHeight: "22pt", fontWeight: 400, textDecoration: "underline", textUnderlineOffset: "2.4pt", textDecorationThickness: "0.8pt", whiteSpace: "pre" }}>
          {"PROFORMA  INVOICE"}
        </h1>
      </header>

      {/* Customer (left) and the invoice details (right) */}
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
        <div style={{ width: "176pt", fontSize: "12pt", lineHeight: "14pt", paddingTop: "0.4pt" }}>
          <div>DATE: {piDate(doc.date)}</div>
          <div style={{ marginTop: "0.7pt" }}>
            Invoice.NO. <b>{doc.number}</b>
          </div>
          {co.taxNo && (
            <div style={{ fontFamily: ARIAL, fontSize: "11pt", lineHeight: "12.6pt", marginTop: "4.4pt", marginLeft: "-1.3pt" }}>
              Business License No:
              <br />
              <b>{co.taxNo}</b>
            </div>
          )}
          {co.website && (
            <div style={{ marginTop: "1.2pt" }}>
              <a href={`https://${co.website.replace(/^https?:\/\//, "")}`} style={{ color: "#0000FF", textDecoration: "underline", textDecorationThickness: "0.6pt" }}>
                {co.website}
              </a>
            </div>
          )}
          {co.email && <div style={{ marginTop: "-0.3pt" }}>Email:{co.email}</div>}
        </div>
      </section>

      {/* The lines */}
      <table style={{ width: "100%", marginTop: "13.6pt", borderCollapse: "collapse", tableLayout: "fixed", fontSize: "10pt", lineHeight: "11.5pt" }}>
        <colgroup>
          <col style={{ width: "28.5pt" }} />
          <col />
          <col style={{ width: "71.4pt" }} />
        </colgroup>
        <thead style={{ display: "table-header-group" }}>
          <tr style={{ background: HEADER_BLUE, fontWeight: 700 }}>
            <th style={{ ...cell, paddingTop: 0, paddingBottom: 0 }}>No.</th>
            <th style={{ ...cell, paddingTop: 0, paddingBottom: 0 }}>Equipment Description</th>
            <th style={{ ...cell, paddingTop: 0, paddingBottom: 0 }}>Qty.</th>
          </tr>
        </thead>
        <tbody>
          {o.documentTitle && (
            <tr>
              <td style={cell} />
              <td style={{ ...cell, textAlign: "center", fontWeight: 700, fontSize: "12pt", lineHeight: "13.9pt", padding: 0, textTransform: "uppercase" }}>{o.documentTitle}</td>
              <td style={cell} />
            </tr>
          )}
          {doc.lines.map((l, i) => (
            <tr key={i} style={{ breakInside: "avoid", height: "20.2pt" }}>
              <td style={cell}>{i + 1}</td>
              <td style={{ ...cell, whiteSpace: "pre-line" }}>
                {l.description}
                {l.model ? `\nModel: ${l.model}` : ""}
              </td>
              <td style={cell}>{piQty(l.quantity, l.unit)}</td>
            </tr>
          ))}
          {extraRows.map((r) => (
            <tr key={r.label}>
              <td colSpan={2} style={{ ...cell, fontWeight: 700 }}>
                {r.label}
              </td>
              <td style={{ ...cell, fontWeight: 700, whiteSpace: "nowrap" }}>{r.value}</td>
            </tr>
          ))}
          {t && (
            <tr style={{ fontWeight: 700, fontSize: "12pt", lineHeight: "13.8pt", breakInside: "avoid" }}>
              <td colSpan={2} style={{ ...cell, padding: "0 5.6pt" }}>
                <span style={{ display: "inline-block", minWidth: "133.7pt" }}>Total {o.incoterm} Price :</span>
                {piWords(t.total, currency)}
              </td>
              <td style={{ ...cell, padding: "0 5.1pt", whiteSpace: "nowrap" }}>{piMoney(t.total, currency)}</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Payment terms, bank details and the stamp, in one box under the table */}
      <section style={{ position: "relative", border: LINE, borderTop: "none", minHeight: "232.7pt", padding: "15pt 5.6pt 30pt 5.6pt", breakInside: "avoid" }}>
        <div style={{ paddingLeft: "1.8pt" }}>Payment terms:</div>
        <ul style={{ margin: "0.3pt 0 0", paddingLeft: "22.4pt", listStyle: "none", lineHeight: "11.75pt" }}>
          {bullets.map((b, i) => (
            <li key={i} style={{ position: "relative", paddingLeft: "15pt" }}>
              <span aria-hidden style={{ position: "absolute", left: 0, fontFamily: "Symbol, 'Liberation Serif', serif" }}>
                •
              </span>
              {b}
            </li>
          ))}
        </ul>
        {co.bankDetails && (
          <div style={{ marginTop: "23.4pt", lineHeight: "11.5pt", position: "relative", zIndex: 1 }}>
            <div style={{ fontWeight: 700 }}>BANK DETAILS:</div>
            <div style={{ marginTop: "11.2pt", whiteSpace: "pre-line" }}>{co.bankDetails}</div>
          </div>
        )}
        {co.stamp && (
          // eslint-disable-next-line @next/next/no-img-element -- a data URL from Settings, printed as is
          <img src={co.stamp} alt="Company stamp" style={{ position: "absolute", left: "412.9pt", top: "28.2pt", width: "112.8pt", height: "107.6pt", objectFit: "contain", mixBlendMode: "multiply" }} />
        )}
      </section>
    </article>
  );
}
