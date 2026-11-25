import type { ReactNode } from "react";
import type { PaperCell, PaperDoc } from "@kebo/shared";
import {
  docDate,
  docFootCell,
  docItem,
  docMoney,
  docQty,
  docWords,
  KeboDoc,
  labelled,
  said,
  type DocBrand,
  type DocColumn,
} from "./kebo-doc";
import type { DocLang } from "./zh";

/** A table cell or a detail beside the title, as Kebo's documents print it. */
function cell(v: PaperCell | undefined): ReactNode {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if ("item" in v) return docItem(v.item, v.model);
  if ("money" in v) return docMoney(v.money, v.currency);
  if ("qty" in v) return docQty(v.qty, v.unit);
  return docDate(v.date);
}

/** A detail the paper still needs (e.g. the B/L number): a yellow "needed". */
function Needed() {
  return (
    <span
      style={{
        background: "#FDE68A",
        color: "#713F12",
        padding: "0 5px",
        borderRadius: "3px",
        printColorAdjust: "exact",
        WebkitPrintColorAdjust: "exact",
      }}
    >
      needed
    </span>
  );
}

type Row = PaperDoc["rows"][number];

/**
 * One paper the app makes (GET /orders/:id/papers/:kind/doc), in Kebo's one
 * document template: the API sends the title, details, party, columns, rows,
 * total, terms and signatures; this only prints them.
 */
export function PaperSheet({
  doc,
  brand,
  watermark,
  lang = "en",
}: {
  doc: PaperDoc;
  brand: DocBrand | null;
  watermark: string | null;
  lang?: DocLang;
}) {
  const columns: DocColumn<Row>[] = doc.columns.map((c) => ({
    label: c.label,
    width: c.width,
    align: c.align,
    wrap: c.wrap,
    // A draft shows an HS code still missing as "needed", where it will print (the Make window's amber).
    render: (r) => (c.key === "hs" && !r[c.key] && watermark === "DRAFT" ? <Needed /> : cell(r[c.key])),
  }));
  const first = doc.foot ? doc.columns.findIndex((c) => c.key in doc.foot!.cells) : -1;
  const foot =
    doc.foot && first > 0 ? (
      <tr style={{ breakInside: "avoid" }}>
        <td colSpan={first} style={{ ...docFootCell(), paddingLeft: 0 }}>
          {said(doc.foot.label, lang)}
        </td>
        {doc.columns.slice(first).map((c, i, all) => (
          <td key={c.key} style={{ ...docFootCell(c.align), ...(i === all.length - 1 ? { paddingRight: 0 } : null) }}>
            {cell(doc.foot!.cells[c.key])}
          </td>
        ))}
      </tr>
    ) : null;
  return (
    <KeboDoc
      brand={brand}
      company={doc.company}
      customer={{ ...doc.party, label: doc.party.label ?? (doc.kind === "payment-receipt" ? "Received from" : null) }}
      title={doc.title}
      numberLabel={doc.numberLabel}
      number={doc.number}
      date={doc.date}
      meta={doc.meta.map((m) => ({ label: m.label, value: m.value === null ? <Needed /> : cell(m.value) }))}
      heading={doc.heading}
      columns={columns}
      rows={doc.rows}
      sums={doc.sums.map((s) => ({ label: s.label, value: String(cell(s.value)) }))}
      total={
        doc.total
          ? {
              label: doc.total.label,
              words: docWords(doc.total.amount, doc.total.currency),
              amount: docMoney(doc.total.amount, doc.total.currency),
              under: (doc.under ?? []).map((s) => ({ label: s.label, value: String(cell(s.value)) })),
            }
          : null
      }
      foot={foot}
      boxTitle={doc.boxTitle}
      bullets={doc.bullets.map((b) => (typeof b === "string" ? b : labelled(b.label, cell(b.value), lang)))}
      bank={doc.bank}
      signatures={doc.signatures}
      watermark={watermark}
      details={doc.details ?? null}
      lang={lang}
    />
  );
}
