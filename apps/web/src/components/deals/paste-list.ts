/**
 * Turns a pasted list (from Excel, a WhatsApp message or an email) into item
 * rows. Each non-empty line is an item; an indented line, a bullet ("- ", "• ")
 * or a "2.1"-style number is a part of the item above. Excel rows (tab
 * separated) read as description, then model, quantity and unit in any order;
 * plain text takes a quantity and unit at the end ("Gate valve DN100 x 200 pcs").
 */
export interface PastedItem {
  description: string;
  model: string;
  quantity: string;
  unit: string;
  part: boolean;
}

const UNITS =
  "pcs|pc|pieces?|sets?|units?|nos?|kg|kgs|tons?|t|mt|m|meters?|m2|m²|sqm|m3|m³|cbm|rolls?|cartons?|ctns?|boxes|box|pairs?|lots?|litres?|liters?|l|bags?|drums?";
const NUM = "(\\d+(?:[.,]\\d+)?)";
/** "… 200 pcs", "… - 200 pcs", "… x 200": a unit makes any separator enough; a bare number needs a clear one (so "Flange PN 16" keeps its 16). */
const TAIL_UNIT = new RegExp(`(?:[,;:\\s\\-–—]+|\\s*[x×]\\s*|\\s+qty[:.]?\\s*)${NUM}\\s*(${UNITS})\\.?\\s*$`, "i");
const TAIL_BARE = new RegExp(`(?:\\s*[,;:\\-–—]\\s*|\\s+[x×]\\s*|\\s+qty[:.]?\\s*)${NUM}\\s*$`, "i");
const QTY_FIRST = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*(${UNITS})\\s+(?:of\\s+|x\\s+)?(.+)$`, "i");
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
  return x;
};

const qtyText = (v: string) => v.replace(",", ".");

const HEADER = /^(s\.?\s?no\.?|no\.?|#|item|items|description|product|model|part no\.?|qty|quantity|unit|uom|price|target)$/i;
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
      if (cols.every((c) => !c || HEADER.test(c))) continue; // the header row
      // A leading "1" / "2.1" column is the customer's numbering.
      const numberCol = /^\d+(\.\d+)?\.?$/.test(cols[0]!) && cols.length > 2 ? cols.shift()! : null;
      const description = cols[0]!.replace(NUMBERED, "").trim();
      let quantity = "";
      let unit = "";
      let model = "";
      for (const c of cols.slice(1)) {
        if (!c) continue;
        if (!quantity && /^\d+(?:[.,]\d+)?$/.test(c)) quantity = qtyText(c);
        else if (!unit && new RegExp(`^(${UNITS})$`, "i").test(c)) unit = normalUnit(c);
        else if (!model) model = c;
      }
      const sub = !!numbered?.[2] || /^\d+\.\d+/.test(numberCol ?? "");
      if (description) out.push({ description, model, quantity, unit, part: sub && out.length > 0 });
      continue;
    }
    const first = line.match(QTY_FIRST);
    if (first) {
      out.push({ description: first[3]!.trim(), model: "", quantity: qtyText(first[1]!), unit: normalUnit(first[2]), part });
      continue;
    }
    const tail = line.match(TAIL_UNIT) ?? line.match(TAIL_BARE);
    if (tail && tail.index! > 0)
      out.push({ description: line.slice(0, tail.index).trim(), model: "", quantity: qtyText(tail[1]!), unit: normalUnit(tail[2]), part });
    else out.push({ description: line, model: "", quantity: "", unit: "", part });
  }
  return out;
}
