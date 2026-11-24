/**
 * Turns a pasted list (from Excel, a WhatsApp message or an email) into item
 * rows. Each non-empty line is an item; an indented line, a bullet ("- ", "• ")
 * or a "2.1"-style number is a part of the item above. Excel rows (tab
 * separated) read as description, then model, quantity and unit in any order;
 * plain text takes a quantity and unit at the end ("Gate valve DN100 x 200 pcs"). A header row, when there is one,
 * says which column is which; without it a second number is the target price (review 24 Nov: it was dropped).
 */
export interface PastedItem {
  description: string;
  model: string;
  quantity: string;
  unit: string;
  /** The customer's target price per unit, when a column gives it. */
  price: string;
  part: boolean;
}

type Role = "description" | "model" | "quantity" | "unit" | "price" | "no" | null;
/** What a header cell names. */
const roleOf = (h: string): Role => {
  const x = h.trim().toLowerCase().replace(/[.:]/g, "");
  if (/^(s ?no|no|#|sr|sl)$/.test(x)) return "no";
  if (/^(item|items|description|product|name|goods)$/.test(x)) return "description";
  if (/^(model|part no|part number|type|spec|specification)$/.test(x)) return "model";
  if (/^(qty|quantity|amount)$/.test(x)) return "quantity";
  if (/^(unit|uom|units)$/.test(x)) return "unit";
  if (/(price|target|budget|rate)/.test(x)) return "price";
  return null;
};

const UNITS =
  "pcs|pc|pieces?|sets?|units?|nos?|kg|kgs|tons?|t|mt|m|meters?|m2|m²|sqm|m3|m³|cbm|rolls?|cartons?|ctns?|boxes|box|pairs?|lots?|litres?|liters?|l|bags?|drums?";
const NUM = "(\\d+(?:[.,]\\d+)?)";
/** "… 200 pcs", "… - 200 pcs", "… x 200": a unit makes any separator enough; a bare number needs a clear one (so "Flange PN 16" keeps its 16). */
const TAIL_UNIT = new RegExp(`(?:[,;:\\s\\-–—]+|\\s*[x×]\\s*|\\s+quantity[:.]?\\s*)${NUM}\\s*(${UNITS})\\.?\\s*$`, "i");
const TAIL_BARE = new RegExp(`(?:\\s*[,;:\\-–—]\\s*|\\s+[x×]\\s*|\\s+quantity[:.]?\\s*)${NUM}\\s*$`, "i");
const QTY_FIRST = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*(${UNITS})\\s+(?:of\\s+|x\\s+)?(.+)$`, "i");
/** A text ending in a measure ("8mm", "2.5 in") before " x ": a length after it is more of the size ("8mm x 30 m"). */
const DIMENSION = /\d+(?:[.,]\d+)?\s*(mm|cm|m|in|inch|"|ft)\s*$/i;
const LENGTH_UNIT = /^(m|mm|cm|meters?|metres?|ft|in|inch)$/i;
const NUMBERED = /^\s*(?:(\d+)\.(\d+)[.)]?|\d+[.)]|[-•*–])\s+/;

const normalUnit = (u: string | undefined) => {
  if (!u) return "";
  const x = u.toLowerCase();
  if (/^(pc|pieces?|nos?|units?)$/.test(x)) return "pcs";
  if (/^sets?$/.test(x)) return "sets";
  if (/^(tons?|t|mt)$/.test(x)) return "tons";
  if (/^(m2|m²|sqm)$/.test(x)) return "m²";
  if (/^(m3|m³|cbm)$/.test(x)) return "m³";
  if (/^(ctns?|cartons?)$/.test(x)) return "cartons";
  // As named in the unit dropdown.
  if (/^(meters?|metres?)$/.test(x)) return "m";
  if (/^(kgs)$/.test(x)) return "kg";
  if (/^(box|boxes)$/.test(x)) return "boxes";
  if (/^(l|litres?|liters?)$/.test(x)) return "litres";
  if (/^(rolls?|bags?|pairs?|drums?)$/.test(x)) return x.endsWith("s") ? x : `${x}s`;
  if (/^lots?$/.test(x)) return "lot";
  return x;
};

const qtyText = (v: string) => v.replace(",", ".");

const HEADER = /^(s\.?\s?no\.?|no\.?|#|item|items|description|product|model|part no\.?|qty|quantity|unit|uom|price|target|target price|unit price|budget)$/i;
const BULLET = /^\s*[-•*–]\s+/;
const indentOf = (l: string) => l.match(/^[ \t]*/)![0].replace(/\t/g, "    ").length;

export function parseList(text: string): PastedItem[] {
  const out: PastedItem[] = [];
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => l.trim());
  // Bullets and indents mean "a part" only when the list mixes them with plain lines.
  const bullets = lines.filter((l) => BULLET.test(l)).length;
  const mixedBullets = bullets > 0 && bullets < lines.length;
  const baseIndent = Math.min(...lines.filter((l) => !l.trim().includes("\t")).map(indentOf));
  // The header row's columns, when there is one: each later row is read by them.
  let roles: Role[] | null = null;
  for (const raw of lines) {
    const numbered = raw.match(NUMBERED);
    const indented = !raw.trim().includes("\t") && indentOf(raw) >= baseIndent + 2;
    const part = out.length > 0 && (indented || !!numbered?.[2] || (mixedBullets && BULLET.test(raw)));
    const line = raw.replace(NUMBERED, "").trim();
    if (raw.trim().includes("\t")) {
      // A row copied from a spreadsheet: description first, then whatever columns follow.
      const cols = raw
        .trim()
        .split("\t")
        .map((c) => c.trim());
      if (cols.every((c) => !c || HEADER.test(c))) {
        // The header row: kept to read the rows under it.
        roles = cols.map(roleOf);
        continue;
      }
      if (roles && roles.includes("description")) {
        const at = (r: Role) => {
          const i = roles!.indexOf(r);
          return i >= 0 ? (cols[i] ?? "").trim() : "";
        };
        const description = at("description").replace(NUMBERED, "").trim();
        const sub = /^\d+\.\d+/.test(at("no"));
        const num = (v: string) => v.replace(/,/g, "").replace(/[^\d.]/g, "");
        if (description)
          out.push({ description, model: at("model"), quantity: qtyText(num(at("quantity"))), unit: normalUnit(at("unit")), price: num(at("price")), part: sub && out.length > 0 });
        continue;
      }
      // A leading "1" / "2.1" column is the customer's numbering.
      const numberCol = /^\d+(\.\d+)?\.?$/.test(cols[0]!) && cols.length > 2 ? cols.shift()! : null;
      const description = cols[0]!.replace(NUMBERED, "").trim();
      let quantity = "";
      let unit = "";
      let model = "";
      let price = "";
      for (const c of cols.slice(1)) {
        if (!c) continue;
        const n = c.replace(/,(?=\d{3}\b)/g, "");
        if (!quantity && /^\d+(?:[.,]\d+)?$/.test(c)) quantity = qtyText(c);
        // A second number (after the quantity) is the target price.
        else if (quantity && !price && /^\d+(?:\.\d+)?$/.test(n)) price = n;
        else if (!unit && new RegExp(`^(${UNITS})$`, "i").test(c)) unit = normalUnit(c);
        else if (!model) model = c;
      }
      const sub = !!numbered?.[2] || /^\d+\.\d+/.test(numberCol ?? "");
      if (description) out.push({ description, model, quantity, unit, price, part: sub && out.length > 0 });
      continue;
    }
    const first = line.match(QTY_FIRST);
    if (first) {
      out.push({ description: first[3]!.trim(), model: "", quantity: qtyText(first[1]!), unit: normalUnit(first[2]), price: "", part });
      continue;
    }
    const tail = line.match(TAIL_UNIT) ?? line.match(TAIL_BARE);
    // "8mm x 30 m": a size times a length is the item's size, not a quantity (review 24 Nov).
    const size = tail && /[x×]/i.test(tail[0]) && LENGTH_UNIT.test(tail[2] ?? "") && DIMENSION.test(line.slice(0, tail.index));
    if (tail && tail.index! > 0 && !size)
      out.push({ description: line.slice(0, tail.index).trim(), model: "", quantity: qtyText(tail[1]!), unit: normalUnit(tail[2]), price: "", part });
    else out.push({ description: line, model: "", quantity: "", unit: "", price: "", part });
  }
  return out;
}
