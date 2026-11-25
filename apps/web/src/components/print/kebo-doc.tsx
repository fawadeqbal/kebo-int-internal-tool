import { Fragment, type CSSProperties, type ReactNode } from "react";
import { countText, paperDateText, paperMoneyText, paperWordsText, portsOf, type PaperDetails } from "@kebo/shared";
import type { CompanySnapshot, CustomerSnapshot } from "@/lib/types-orders";
import { countryName, isUnknownCountry } from "@/lib/countries";
import { zhOf, type DocLang } from "./zh";

/**
 * Every Kebo document — quotation, proforma invoice and packing list — in one
 * layout: the "Modern Minimal" design (logo and contacts at the top, a navy
 * and gold rule, the title with the date and details beside it, the customer
 * in a light-blue box, an open table, the total in a navy bar, the terms with
 * the stamp, and a footer with the business licence and page numbers).
 *
 * Each priced document has two copies:
 *  - the customer's: the items and quantities, and one total at the end;
 *  - the internal one (never sent): unit prices, amounts, costs and margin,
 *    and every payment, under a red "internal copy" band.
 *
 * Sizes are CSS pixels on an A4 sheet 794 px wide (as the design), so the
 * screen and the PDF match.
 */

const SANS = "'Kebo Inter', Inter, Arial, 'Liberation Sans', sans-serif";
const DISPLAY = "'Kebo Jakarta', 'Plus Jakarta Sans', 'Kebo Inter', Inter, Arial, sans-serif";
const CJK = "'Noto Sans CJK SC', 'Noto Sans SC', 'Microsoft YaHei', 'PingFang SC', sans-serif";
const NAVY = "#063C8C";
const BLUE = "#0B5ED7";
const GOLD = "#B08D3C";
const GOLD_TEXT = "#8A6A22";
const TINT = "#F5F9FE";
const RULE = "#DCE8F5";
const INK = "#1A1A1A";
const TEXT_2 = "#444444";
const LABEL_GREY = "#555555";
/** Page margins (the footer sits in the bottom one). */
const MARGIN = { top: 44, side: 52, bottom: 64 };
/** A company's brand at the top of its documents, from Settings → Company: its logo (or its initials), the title and the line under it. */
export interface DocBrand {
  logo: string | null;
  mark: string;
  tagline: string | null;
}

/** Initials in a navy and gold ring, for a company that has not uploaded a logo yet. */
function Monogram({ mark }: { mark: string }) {
  const letters =
    mark
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("") || "·";
  return (
    <div
      style={{
        ...exact,
        width: "62px",
        height: "62px",
        flexShrink: 0,
        borderRadius: "50%",
        border: `3px solid ${GOLD}`,
        background: NAVY,
        color: "#FFFFFF",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: DISPLAY,
        fontWeight: 800,
        fontSize: letters.length > 1 ? "22px" : "26px",
        letterSpacing: "0.04em",
      }}
    >
      {letters}
    </div>
  );
}

const exact: CSSProperties = { printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" };
const label: CSSProperties = { fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" };

/* ---------------------------------------------------------------- formatting, as on Kebo's documents */

/** "SEP 16, 2026" */
/**
 * The name of a paper's total: "Total FOB Price :", but not when its lines also charge the freight or insurance
 * past that point (review 24 Nov, S-21: "Total FOB Price" with sea freight in it), then "Total Price :".
 */
export function totalPriceLabel(incoterm: string | null | undefined, lines: { type: string; description: string }[], lead = "") {
  const beforeShipping = !incoterm || ["EXW", "FCA", "FAS", "FOB"].includes(incoterm);
  const carriage = lines.some((l) => l.type !== "goods" && /\b(freight|shipping|carriage|insurance)\b/i.test(l.description));
  return `${lead}Total ${incoterm && !(beforeShipping && carriage) ? `${incoterm} ` : ""}Price :`;
}

/**
 * An A4 sheet on a narrow screen: the whole page smaller, as it prints, rather than squeezed to the screen's
 * width (review 24 Nov, X-08: the address a word per line). Inside the app's viewer it is drawn at its size.
 */
export const paperZoomCss = (sheet: string) => `@media screen and (max-width: 820px) { ${sheet} { zoom: 0.9; } }
@media screen and (max-width: 720px) { ${sheet} { zoom: 0.72; } }
@media screen and (max-width: 600px) { ${sheet} { zoom: 0.58; } }
@media screen and (max-width: 480px) { ${sheet} { zoom: 0.47; } }
@media screen and (max-width: 400px) { ${sheet} { zoom: 0.42; } }
@media screen and (max-width: 360px) { ${sheet} { zoom: 0.38; } }
html[data-embedded] ${sheet} { zoom: 1 !important; }`;

export function docDate(iso: string) {
  // One style on every paper, the same as inside its sentences: "04 Sep 2026" (review 24 Nov: "SEP 4, 2026" beside
  // "04 Sep 2026"). Papers go abroad, so the month is in letters whatever the company's own date setting.
  return paperDateText(iso);
}

/** "USD 90,000.00", as the app and every other paper write it (the ISO code, never "$": many currencies use it). */
export function docMoney(amount: string | number, currency: string) {
  const n = Number(amount);
  return n < 0 ? `- ${paperMoneyText(-n, currency)}` : paperMoneyText(n, currency);
}

/** "USD Ninety Thousand only" */
export const docWords = (amount: string, currency: string) => paperWordsText(amount, currency);

/** "1 Set", "2,000 pcs" */
export function docQty(quantity: string | number, unit?: string | null) {
  return countText(quantity, unit);
}

/** Free text (terms, notes) as list items: one per line, without the "1." numbering people type. */
export function textBullets(text: string | null | undefined) {
  return (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, "").trim())
    .filter(Boolean);
}

/**
 * "Port of loading" / "Port of discharge": the shipment's when given (the packing list since the shipment is the
 * one place), else from the terms (portsOf: the Incoterm place is where goods are loaded for E and F terms,
 * where they go for C and D terms, unless the order names its destination).
 */
export function portBullets(
  incoterm: string,
  place: string | null,
  portOfDischarge?: string | null,
  shipment?: { portOfLoading: string | null; portOfDischarge: string | null } | null,
  lang: DocLang = "en",
): ReactNode[] {
  const p = shipment ?? portsOf({ incoterm, incotermPlace: place, portOfDischarge: portOfDischarge ?? null });
  const loading = p.portOfLoading;
  const discharge = p.portOfDischarge;
  return [
    loading ? <Labelled key="pol" label="Port of loading:" value={loading} lang={lang} /> : null,
    discharge ? <Labelled key="pod" label="Port of discharge:" value={discharge} lang={lang} /> : null,
  ].filter(Boolean);
}

function Labelled({ label: l, value, lang }: { label: string; value: ReactNode; lang: DocLang }) {
  return (
    <>
      {said(l, lang)} {value}
    </>
  );
}

/** A list item with a label, e.g. "B/L No.: QDLOS-77" ("B/L No. 提单号: QDLOS-77" with Chinese). */
export const labelled = (l: string, value: ReactNode, lang: DocLang = "en") => <Labelled label={l} value={value} lang={lang} />;

/**
 * A label in the paper's language: "Port of loading:", or with Chinese "Port of loading 装运港:". A label the
 * dictionary does not have prints in English only.
 */
export function said(text: string, lang: DocLang): ReactNode {
  const zh = lang === "zh" ? zhOf(text) : null;
  if (!zh) return text;
  const colon = /:\s*$/.test(text);
  return (
    <>
      {text.replace(/\s*:\s*$/, "")} <span style={{ fontFamily: CJK, letterSpacing: 0 }}>{zh}</span>
      {colon ? ":" : ""}
    </>
  );
}

/** A column's heading: with Chinese, the Chinese over the English ("箱号" over "Case No."), as the customer's own papers. */
function headed(text: string, lang: DocLang): ReactNode {
  const zh = lang === "zh" ? zhOf(text) : null;
  return zh ? (
    <>
      <div style={{ fontFamily: CJK, letterSpacing: 0, textTransform: "none" }}>{zh}</div>
      {text}
    </>
  ) : (
    text
  );
}

/** An item's description cell: the first line as its name, the rest (specs) and the model under it. */
export function docItem(description: string, model?: string | null) {
  const [name, ...more] = description.split(/\r?\n/);
  return (
    <>
      <div style={{ fontWeight: 600 }}>{name}</div>
      {more.length > 0 && <div style={{ color: TEXT_2, fontSize: "12px", whiteSpace: "pre-line" }}>{more.join("\n")}</div>}
      {model && <div style={{ color: LABEL_GREY, fontSize: "12px" }}>Model: {model}</div>}
    </>
  );
}

/** A cell in a row under the items (e.g. the packing list's totals). */
export const docFootCell = (align: "left" | "right" = "left"): CSSProperties => ({
  padding: "10px 6px",
  borderTop: `1.5px solid ${INK}`,
  fontWeight: 700,
  textAlign: align,
  verticalAlign: "top",
});

/** Short words written small inside a title ("Statement of Account", not "Statement OF Account"). */
const SMALL_WORDS = new Set(["of", "and", "the", "for", "to", "on", "in", "at", "by", "or"]);
/** "PROFORMA  INVOICE" → "Proforma Invoice"; short abbreviations stay as they are ("SAT CERTIFICATE" → "SAT Certificate"). */
const titleCase = (t: string) =>
  t
    .trim()
    .split(/\s+/)
    .map((w, i) =>
      i > 0 && SMALL_WORDS.has(w.toLowerCase())
        ? w.toLowerCase()
        : /^[A-Z]{2,3}$/.test(w)
          ? w
          : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join(" ");
/** "Invoice.NO." → "Invoice No." */
const numberText = (l: string) => l.replace(/\.?\s*no\.?\s*:?\s*$/i, " No.").trim();
const noColon = (t: string) => t.replace(/\s*:\s*$/, "");
/** A string inside a CSS content: "…". */
const cssString = (t: string) => `"${t.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;

/* ---------------------------------------------------------------- the document */

export interface DocColumn<T> {
  label: string;
  /** Fixed width in pt; the description column takes the rest. */
  width?: number;
  align?: "left" | "right";
  /** Let a fixed-width column wrap (e.g. "2 Wooden boxes"). */
  wrap?: boolean;
  render: (row: T, index: number) => ReactNode;
  /**
   * How many rows this cell covers (the packing list's item over its cases): 1 by default; 0 for a row whose
   * cell is covered by one above.
   */
  span?: (row: T, index: number) => number;
}

type Sum = { label: string; value: string };
/** `under`: lines below the total (what was already received, then what is left to pay, in bold). */
type Total = { label: string; words: string; amount: string; under?: Sum[] };

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
  groups,
  foot,
  boxTitle = "Payment terms:",
  bullets,
  bank,
  internal,
  internalBand = "INTERNAL COPY — FOR OUR OWN USE, NOT FOR THE CUSTOMER",
  watermark,
  brand = null,
  signatures = null,
  details: particulars = null,
  lang = "en",
}: {
  company: CompanySnapshot;
  customer: CustomerSnapshot;
  /** "QUOTATION", "PROFORMA  INVOICE" (shown as "Proforma Invoice"). */
  title: string;
  /** "Invoice.NO.", shown before the number under the title (as "Invoice No."). */
  numberLabel?: string;
  number: string;
  date: string;
  /** More details beside the date, e.g. "Valid until". */
  meta?: { label: string; value: ReactNode }[];
  /** A heading row over the items, e.g. "COMPLETE AUTOMATIC LIQUID SYRUP FILLING LINE". */
  heading?: string | null;
  columns: DocColumn<T>[];
  rows: T[];
  /** Lines before the total (subtotal, discount). */
  sums?: Sum[];
  /** "Total FOB Price", the amount in words and in figures. */
  total?: Total | null;
  /**
   * Instead of rows / sums / total: several blocks in the same table, each
   * under its own heading with its own total — a quotation's options A, B…
   */
  groups?: { heading: string; rows: T[]; sums?: Sum[]; total?: Total | null }[];
  /** Rows after the items instead of a money total (the packing list). */
  foot?: ReactNode;
  boxTitle?: string;
  bullets: ReactNode[];
  bank?: string | null;
  /** The internal copy: a red band at the top and this section after the terms. */
  internal?: ReactNode;
  internalBand?: string;
  watermark?: string | null;
  /** The company's logo and wordmark; none: its name as the letterhead. */
  brand?: DocBrand | null;
  /**
   * Who signs ("For the seller · Shandong Kebo …" and "For the buyer · …"; the left is always ours): the closing
   * block, kept on one page with what is signed for, our seal over our signature.
   */
  signatures?: { left: string; right: string } | null;
  /** Under the title, in place of the customer's box: shipper, buyer, the bank by the route and the shipping. */
  details?: PaperDetails | null;
  /** English, or English with the Chinese beside each label. */
  lang?: DocLang;
}) {
  const address = customer.address?.trim() || (isUnknownCountry(customer.country) ? "" : countryName(customer.country));
  const width = (c: DocColumn<T>) => (c.width ? `${c.width}pt` : undefined);
  const contacts = [
    company.phone ? { icon: <IconPhone />, text: company.phone } : null,
    // Both emails, as Settings › Company says they print (review 24 Nov: the second never printed).
    company.email || company.email2 ? { icon: <IconMail />, text: [company.email, company.email2].filter(Boolean).join(" · ") } : null,
    company.website ? { icon: <IconGlobe />, text: company.website, href: `https://${company.website.replace(/^https?:\/\//, "")}` } : null,
    company.address ? { icon: <IconPin />, text: company.address } : null,
  ].filter((x) => x !== null);
  const details = [{ label: "Date", value: docDate(date) as ReactNode }, ...meta.map((m) => ({ label: noColon(m.label), value: m.value }))];
  const zh = (t: string) => (lang === "zh" ? zhOf(t) : null);
  // Hidden on the Make window ("Terms and notes" off): no empty heading left behind.
  const terms = bullets.length > 0 && (
    <div style={{ breakInside: "avoid", marginBottom: "16px" }}>
      <div style={{ ...label, color: BLUE }}>{said(noColon(boxTitle), lang)}</div>
      <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {bullets.map((b, i) => (
          <li key={i} style={{ display: "flex", gap: "4px", whiteSpace: "pre-line" }}>
            <span style={{ flexShrink: 0 }}>{i + 1}.</span>
            <span style={{ minWidth: 0 }}>{b}</span>
          </li>
        ))}
      </ol>
    </div>
  );
  const bankBox = bank && (
    <div style={{ breakInside: "avoid" }}>
      <div style={{ ...label, color: BLUE }}>{said("Bank details", lang)}</div>
      <div style={{ whiteSpace: "pre-line" }}>{bank}</div>
    </div>
  );
  const footLeft = company.taxNo
    ? `Business License No. ${zh("Business License No.") ? `${zh("Business License No.")} ` : ""}${company.taxNo}`
    : "";
  // The company's own line at the bottom (Settings › Company › Invoice footer), else the usual thanks.
  const thanks =
    company.invoiceFooter?.trim().replace(/\s*\n\s*/g, " · ") ||
    `Thank you for your business${zh("Thank you for your business") ? ` · ${zh("Thank you for your business")}` : ""}`;
  const th = (c: DocColumn<T>, i: number): CSSProperties => ({
    ...label,
    color: TEXT_2,
    padding: i === 0 ? "8px 6px 8px 0" : i === columns.length - 1 ? "8px 0 8px 6px" : "8px 6px",
    textAlign: c.align ?? "left",
    // A narrow column that wraps its cells wraps its heading too ("N.W. (kg)" over two lines).
    whiteSpace: c.wrap ? "normal" : "nowrap",
  });
  const td = (c: DocColumn<T>, i: number): CSSProperties => ({
    padding: i === 0 ? "11px 6px 11px 0" : i === columns.length - 1 ? "11px 0 11px 6px" : "11px 6px",
    verticalAlign: "top",
    textAlign: c.align ?? "left",
    whiteSpace: c.width && !c.wrap ? "nowrap" : "pre-line",
    ...(i === 0 ? { color: BLUE, fontWeight: 700 } : null),
    ...(i === columns.length - 1 && c.align === "right" ? { fontWeight: 600 } : null),
  });

  return (
    <article
      className="kebo-doc relative mx-auto bg-white shadow-[0_1px_3px_rgba(16,24,40,.12),0_8px_24px_rgba(16,24,40,.08)] print:shadow-none"
      style={{
        width: "794px",
        minHeight: "1123px",
        boxSizing: "border-box",
        padding: `${MARGIN.top}px ${MARGIN.side}px ${MARGIN.bottom + 20}px`,
        color: INK,
        fontFamily: SANS,
        fontSize: "12.5px",
        lineHeight: 1.45,
      }}
    >
      {/* On paper the margins come from @page, and the footer and page numbers are drawn in the bottom margin of every page. */}
      <style>{`@page { size: A4; margin: ${MARGIN.top}px ${MARGIN.side}px ${MARGIN.bottom}px;
  @bottom-left { content: ${cssString(footLeft)}; font: 11.5px ${SANS}; color: ${TEXT_2}; vertical-align: top; padding-top: 12px; border-top: 1px solid ${RULE}; }
  @bottom-center { content: ${cssString(thanks)}; text-align: center; font: 11.5px ${SANS}; color: ${TEXT_2}; vertical-align: top; padding-top: 12px; border-top: 1px solid ${RULE}; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); text-align: right; font: 11.5px ${SANS}; color: ${TEXT_2}; vertical-align: top; padding-top: 12px; border-top: 1px solid ${RULE}; }
}
@media print { .kebo-doc { width: auto !important; min-height: 0 !important; padding: 0 !important; } .kebo-doc-foot { display: none !important; } }
${paperZoomCss(".kebo-doc")}`}</style>
      {watermark && (
        // The stamp (DRAFT, VOID, PREVIEW) is meant to be faint behind the paper, so it is drawn (CSS content) and
        // not text a contrast check reads as hard to read: decoration in WCAG 1.4.3's sense. Its word is still
        // read out, so a screen reader hears that the paper is a draft.
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <span data-mark={watermark} className="-rotate-[30deg] border-[6px] border-[#dc2626]/25 px-10 text-[100pt] leading-none font-extrabold tracking-[0.08em] text-[#dc2626]/[0.13] select-none before:content-[attr(data-mark)]" />
        </div>
      )}
      {internal && (
        <div
          style={{
            ...exact,
            marginBottom: "16px",
            background: "#B91C1C",
            color: "#fff",
            borderRadius: "4px",
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textAlign: "center",
            padding: "5px 0",
          }}
        >
          {internalBand}
        </div>
      )}

      {/* Letterhead: the logo and name on the left, how to reach us on the right */}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px", minWidth: 0 }}>
          {brand &&
            (brand.logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- printed as is, also by the PDF renderer
              <img src={brand.logo} alt="" style={{ width: "70px", height: "70px", objectFit: "contain", flexShrink: 0 }} />
            ) : (
              <Monogram mark={brand.mark} />
            ))}
          <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
            {brand ? (
              <>
                <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: "28px", letterSpacing: "0.14em", color: NAVY, lineHeight: 1 }}>{brand.mark}</div>
                {brand.tagline && (
                  <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: "11.5px", letterSpacing: "0.18em", color: GOLD_TEXT, textTransform: "uppercase" }}>
                    {brand.tagline}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: "22px", letterSpacing: "0.04em", color: NAVY, lineHeight: 1.15 }}>{company.name}</div>
            )}
            <div style={{ fontSize: "11.5px", color: TEXT_2, lineHeight: 1.35 }}>
              {brand && company.name}
              {company.nameLocal && (
                <>
                  {brand ? " · " : ""}
                  <span style={{ fontFamily: CJK, whiteSpace: "nowrap" }}>{company.nameLocal}</span>
                </>
              )}
            </div>
          </div>
        </div>
        {contacts.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px", color: "#333333", flexShrink: 0, maxWidth: "290px" }}>
            {contacts.map((x) => (
              <div key={x.text} style={{ display: "flex", alignItems: "flex-start", gap: "8px", lineHeight: 1.35 }}>
                <span style={{ marginTop: "1px", flexShrink: 0, display: "flex" }}>{x.icon}</span>
                {"href" in x && x.href ? (
                  <a href={x.href} style={{ color: "inherit", textDecoration: "none" }}>
                    {x.text}
                  </a>
                ) : (
                  <span style={{ whiteSpace: "pre-line" }}>{x.text}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </header>

      <div style={{ ...exact, marginTop: "22px", display: "flex", height: "3px" }}>
        <div style={{ flex: 7, background: NAVY }} />
        <div style={{ flex: 3, background: GOLD }} />
      </div>

      {/* The title and number, with the date and details beside them */}
      <section style={{ marginTop: "30px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "24px" }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: DISPLAY, fontWeight: 800, fontSize: "34px", color: NAVY, lineHeight: 1 }}>
            {titleCase(title)}
            {zh(titleCase(title)) && (
              <span style={{ fontFamily: CJK, fontWeight: 700, fontSize: "24px", marginLeft: "12px" }}>{zh(titleCase(title))}</span>
            )}
          </h1>
          <div style={{ marginTop: "8px", fontSize: "13px", color: TEXT_2 }}>
            {said(numberText(numberLabel), lang)} <span style={{ color: INK, fontWeight: 600 }}>{number}</span>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${details.length}, auto)`, gap: "22px", lineHeight: 1.45 }}>
          {details.map((d) => (
            <div key={d.label}>
              <div style={{ ...label, color: LABEL_GREY }}>{said(d.label, lang)}</div>
              <div style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{d.value}</div>
            </div>
          ))}
        </div>
      </section>

      {/* The details (shipper, buyer, bank, shipping) on the trade papers; else the customer */}
      {particulars ? (
        <Details d={particulars} lang={lang} />
      ) : (
        <section
          style={{
            ...exact,
            marginTop: "24px",
            background: TINT,
            borderRadius: "8px",
            padding: "14px 18px",
            display: "grid",
            gridTemplateColumns: customer.taxNo || customer.regNo ? "repeat(2, minmax(0, 1fr))" : "1fr",
            gap: "20px",
            lineHeight: 1.5,
            breakInside: "avoid",
          }}
        >
          <div>
            <div style={{ ...label, color: BLUE }}>{said(customer.label ?? "Prepared for", lang)}</div>
            <div style={{ fontWeight: 700, fontSize: "14px" }}>{customer.name}</div>
            {address && <div style={{ whiteSpace: "pre-line" }}>{address}</div>}
          </div>
          {(customer.taxNo || customer.regNo) && (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {customer.taxNo && (
                <div>
                  <div style={{ ...label, color: BLUE }}>{said("Tax No.", lang)}</div>
                  <div>{customer.taxNo}</div>
                </div>
              )}
              {customer.regNo && (
                <div>
                  <div style={{ ...label, color: BLUE }}>{said("Reg. Number", lang)}</div>
                  <div>{customer.regNo}</div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* The items */}
      <table style={{ marginTop: "24px", width: "100%", borderCollapse: "collapse", tableLayout: "fixed", lineHeight: 1.35 }}>
        <colgroup>
          {columns.map((c, i) => (
            <col key={i} style={{ width: width(c) }} />
          ))}
        </colgroup>
        <thead style={{ display: "table-header-group" }}>
          <tr style={{ borderBottom: `1.5px solid ${INK}` }}>
            {columns.map((c, i) => (
              <th key={c.label} style={th(c, i)}>
                {headed(c.label, lang)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {heading && (
            <tr style={{ breakInside: "avoid", breakAfter: "avoid" }}>
              <td
                colSpan={columns.length}
                style={{ padding: "10px 0 6px", textAlign: "center", fontFamily: DISPLAY, fontWeight: 700, fontSize: "13px", letterSpacing: "0.06em", color: NAVY, textTransform: "uppercase" }}
              >
                {heading}
              </td>
            </tr>
          )}
          {(groups ?? [{ heading: "", rows, sums, total }]).map((g, gi) => (
            <Fragment key={gi}>
              {g.heading && (
                <tr style={{ breakInside: "avoid", breakAfter: "avoid" }}>
                  <td colSpan={columns.length} style={{ padding: gi === 0 ? "12px 0 0" : "22px 0 0" }}>
                    <div style={{ ...exact, ...label, color: NAVY, background: TINT, borderLeft: `3px solid ${NAVY}`, padding: "7px 12px" }}>{g.heading}</div>
                  </td>
                </tr>
              )}
              {g.rows.map((r, i) => (
                <tr key={i} style={{ breakInside: "avoid", borderBottom: `1px solid ${RULE}` }}>
                  {columns.map((c, ci) => {
                    const n = c.span ? c.span(r, i) : 1;
                    return n === 0 ? null : (
                      <td key={c.label} rowSpan={n > 1 ? n : undefined} style={td(c, ci)}>
                        {c.render(r, i)}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {((g.sums ?? []).length > 0 || g.total) && (
                <tr style={{ breakInside: "avoid" }}>
                  <td colSpan={columns.length} style={{ padding: "16px 0 0" }}>
                    <Totals sums={g.sums ?? []} total={g.total ?? null} lang={lang} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {foot}
        </tbody>
      </table>

      {/* Terms and bank details, with the stamp; on a signed paper the signatures close it */}
      {signatures ? (
        <section style={{ marginTop: "26px", lineHeight: 1.6 }}>
          {bank && terms}
          {/*
           * The closing stays together on one page: the bank details (else the terms) with the signatures under
           * them, so a signature never starts a page alone with nothing signed for above it.
           */}
          <div style={{ breakInside: "avoid" }}>
            {bank ? bankBox : terms}
            <Signatures left={signatures.left} right={signatures.right} stamp={company.stamp ?? null} lang={lang} />
          </div>
        </section>
      ) : (
        <section style={{ marginTop: "26px", display: "flex", justifyContent: "space-between", gap: "24px", alignItems: "flex-end" }}>
          <div style={{ lineHeight: 1.6, minWidth: 0, flex: 1 }}>
            {terms}
            {bankBox}
          </div>
          {company.stamp && (
            // eslint-disable-next-line @next/next/no-img-element -- a data URL from Settings, printed as is
            <img src={company.stamp} alt="Company stamp" style={{ width: "124px", height: "118px", objectFit: "contain", mixBlendMode: "multiply", flexShrink: 0, breakInside: "avoid" }} />
          )}
        </section>
      )}

      {internal && <section style={{ marginTop: "22px", breakInside: "avoid" }}>{internal}</section>}

      {/* On screen; on paper the same footer is in every page's bottom margin, with page numbers. */}
      <footer
        className="kebo-doc-foot"
        style={{
          position: "absolute",
          left: `${MARGIN.side}px`,
          right: `${MARGIN.side}px`,
          bottom: "34px",
          borderTop: `1px solid ${RULE}`,
          paddingTop: "10px",
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          gap: "16px",
          fontSize: "11.5px",
          color: TEXT_2,
        }}
      >
        <div>{footLeft}</div>
        <div style={{ textAlign: "center" }}>{thanks}</div>
        <div />
      </footer>
    </article>
  );
}

/**
 * The signature block, as contracts are signed: for each side who signs ("For the seller") and for whom (the
 * company), room to sign, then Name, Title and Date to fill in. Our seal (Settings › Company) goes over our
 * signature, the left one. A side with nothing written ("") is left out (a paper only we sign).
 */
function Signatures({ left, right, stamp, lang }: { left: string; right: string; stamp: string | null; lang: DocLang }) {
  const side = (text: string, ours: boolean) => {
    // "For the seller · Shandong Kebo …": who signs, then for whom.
    const [role = "", ...party] = text.split(" · ");
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...label, color: BLUE }}>{said(role, lang)}</div>
        <div style={{ fontWeight: 700, minHeight: "21px" }}>{party.join(" · ")}</div>
        <div style={{ position: "relative", height: "64px", borderBottom: `1px solid ${INK}` }}>
          {ours && stamp && (
            // eslint-disable-next-line @next/next/no-img-element -- a data URL from Settings, printed as is
            <img
              src={stamp}
              alt="Company stamp"
              style={{ position: "absolute", right: "12px", top: "-6px", width: "112px", height: "106px", objectFit: "contain", mixBlendMode: "multiply" }}
            />
          )}
        </div>
        {["Name:", "Title:", "Date:"].map((f) => (
          <div key={f} style={{ display: "flex", alignItems: "flex-end", gap: "8px", marginTop: "8px" }}>
            <span style={{ color: LABEL_GREY, flexShrink: 0, minWidth: "48px" }}>{said(f, lang)}</span>
            <span style={{ flex: 1, borderBottom: `1px solid ${RULE}`, height: "16px" }} />
          </div>
        ))}
      </div>
    );
  };
  return (
    <div style={{ display: "flex", gap: "48px", marginTop: "28px" }}>
      {side(left, true)}
      {right ? side(right, false) : <div style={{ flex: 1 }} />}
    </div>
  );
}

/**
 * Under the title on the trade papers (design "papers in the customer's format", 25 Nov 2026), in the light-blue
 * box: who ships and who buys on the left; on the right the bank as the payment route has it (an LC's "Notify
 * bank" with its number, reference, the proforma's date and the day it was issued; a bank contract's number and
 * bank; nothing on an informal order) and the shipping (ports, HS code, origin). Empty lines are left out.
 */
function Details({ d, lang }: { d: PaperDetails; lang: DocLang }) {
  const head = (t: string, first = false) => <div style={{ ...label, color: BLUE, marginTop: first ? 0 : "12px" }}>{said(t, lang)}</div>;
  const line = (l: string, v: ReactNode) =>
    v ? (
      <div style={{ display: "flex", gap: "6px" }}>
        <span style={{ color: LABEL_GREY, flexShrink: 0 }}>{said(l, lang)}</span>
        <span style={{ minWidth: 0 }}>{v}</span>
      </div>
    ) : null;
  const buyerAddress = d.buyer.address?.trim() || (isUnknownCountry(d.buyer.country) ? "" : countryName(d.buyer.country));
  const b = d.bank;
  return (
    <section
      style={{
        ...exact,
        marginTop: "24px",
        background: TINT,
        borderRadius: "8px",
        padding: "14px 18px",
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: "24px",
        lineHeight: 1.5,
        breakInside: "avoid",
      }}
    >
      <div>
        {head("Shipper", true)}
        <div style={{ fontWeight: 700 }}>{d.shipper.name}</div>
        {d.shipper.address && <div style={{ whiteSpace: "pre-line" }}>{d.shipper.address}</div>}
        {line("Contact No.", d.shipper.phone)}
        {line("Licence No.", d.shipper.licenceNo)}
        {head("Buyer")}
        <div style={{ fontWeight: 700 }}>{d.buyer.name}</div>
        {buyerAddress && <div style={{ whiteSpace: "pre-line" }}>{buyerAddress}</div>}
        {line(d.buyer.taxLabel, d.buyer.taxNo)}
        {line("Reg. Number", d.buyer.regNo)}
      </div>
      <div>
        {b?.kind === "lc" && (
          <>
            {head("Notify bank", true)}
            {line("LC No.", b.number && <strong>{b.number}</strong>)}
            {line("Ref. No.", b.refNo && <strong>{b.refNo}</strong>)}
            {line("Invoice date", b.invoiceDate && docDate(b.invoiceDate))}
            {line("Date of issuance", b.issuedOn && docDate(b.issuedOn))}
            {b.name && <div style={{ fontWeight: 700 }}>{b.name}</div>}
            {b.address && <div style={{ whiteSpace: "pre-line" }}>{b.address}</div>}
          </>
        )}
        {b?.kind === "contract" && (
          <>
            {head("Bank", true)}
            {line("Contract No.", b.number && <strong>{b.number}</strong>)}
            {line("Ref. No.", b.refNo)}
            {b.name && <div style={{ fontWeight: 700 }}>{b.name}</div>}
            {b.address && <div style={{ whiteSpace: "pre-line" }}>{b.address}</div>}
          </>
        )}
        {head("Shipping", !b)}
        {line("Port of loading", d.shipping.portOfLoading)}
        {line("Port of discharge", d.shipping.portOfDischarge)}
        {line("HS code", d.shipping.hsCode)}
        {line("Origin", d.shipping.origin)}
      </div>
    </section>
  );
}

/** The amount in words on the left; the sums and the total (in a navy bar) on the right. */
function Totals({ sums, total, lang }: { sums: Sum[]; total: Total | null; lang: DocLang }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "24px", alignItems: "flex-start" }}>
      <div style={{ fontSize: "12px", color: TEXT_2, maxWidth: "340px", paddingTop: "6px" }}>{total?.words}</div>
      <div style={{ width: "290px", flexShrink: 0, fontSize: "13px" }}>
        {sums.map((s) => (
          <div key={s.label} style={{ display: "flex", justifyContent: "space-between", gap: "12px", padding: "5px 0" }}>
            <span style={{ color: TEXT_2 }}>{said(s.label, lang)}</span>
            <span style={{ whiteSpace: "nowrap" }}>{s.value}</span>
          </div>
        ))}
        {total && (
          <div
            style={{
              ...exact,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "12px",
              marginTop: sums.length ? "6px" : 0,
              padding: "10px 14px",
              background: NAVY,
              color: "#FFFFFF",
              borderRadius: "6px",
            }}
          >
            <span style={{ fontWeight: 600 }}>{said(noColon(total.label), lang)}</span>
            <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: "18px", whiteSpace: "nowrap" }}>{total.amount}</span>
          </div>
        )}
        {(total?.under ?? []).map((s, i, all) => (
          <div
            key={s.label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "12px",
              padding: i === 0 ? "9px 14px 5px" : "5px 14px",
              ...(i === all.length - 1 ? { fontWeight: 700, borderTop: `1px solid ${RULE}`, marginTop: "4px", paddingTop: "8px" } : null),
            }}
          >
            <span style={{ color: i === all.length - 1 ? undefined : TEXT_2 }}>{said(s.label, lang)}</span>
            <span style={{ whiteSpace: "nowrap" }}>{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- icons (as in the design) */

const icon = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: BLUE, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
const IconPhone = () => (
  <svg {...icon}>
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
  </svg>
);
const IconMail = () => (
  <svg {...icon}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-10 6L2 7" />
  </svg>
);
const IconGlobe = () => (
  <svg {...icon}>
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);
const IconPin = () => (
  <svg {...icon}>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

/* ---------------------------------------------------------------- the internal copy's extra sections */

/** A small table in the documents' style, for the internal copy (money, payments, costing). */
export function InternalTable({ title, head, rows, note }: { title: string; head?: string[]; rows: ReactNode[][]; note?: ReactNode }) {
  const c: CSSProperties = { padding: "6px 8px 6px 0", textAlign: "left", verticalAlign: "top", borderBottom: `1px solid ${RULE}` };
  return (
    <div style={{ marginTop: "14px", breakInside: "avoid" }}>
      <div style={{ ...label, color: "#B91C1C", marginBottom: "4px" }}>{title}</div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", lineHeight: 1.4 }}>
        {head && (
          <thead>
            <tr style={{ borderBottom: `1.5px solid ${INK}` }}>
              {head.map((h, i) => (
                <th key={i} style={{ ...c, ...label, color: TEXT_2, borderBottom: "none" }}>
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
                <td key={j} style={{ ...c, ...(j === 0 && !head ? { color: TEXT_2 } : null) }}>
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {note && <div style={{ marginTop: "4px", fontSize: "11px", color: TEXT_2 }}>{note}</div>}
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
