import { writeSheet } from "@/lib/sheets";
import { SHEET_LIMITS, type SheetCol, type SheetSpec } from "@/lib/sheet-spec";
import { sheetGuard } from "../guard";

const MAX_ROWS = 20_000;
const MAX_TEXT = 32_000;

const isText = (v: unknown, max = MAX_TEXT): v is string => typeof v === "string" && v.length <= max;
const isCell = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v)) || isText(v);
const isRow = (r: unknown, width: number) => Array.isArray(r) && r.length <= width && r.every(isCell);

/** What the page sent, checked: it only shapes a file, but nothing unexpected goes into one. */
function specOf(body: unknown): SheetSpec | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (!isText(b.name, 120) || !isText(b.title, 120) || !Array.isArray(b.columns) || !Array.isArray(b.rows)) return null;
  if (b.columns.length === 0 || b.columns.length > SHEET_LIMITS.columns || b.rows.length > MAX_ROWS) return null;
  const columns: SheetCol[] = [];
  for (const c of b.columns as unknown[]) {
    if (!c || typeof c !== "object") return null;
    const x = c as Record<string, unknown>;
    if (!isText(x.header, 200)) return null;
    if (x.choices !== undefined && !(Array.isArray(x.choices) && x.choices.length <= 1000 && x.choices.every((v) => isText(v, 255)))) return null;
    columns.push({
      header: x.header,
      width: typeof x.width === "number" && x.width > 0 && x.width <= 120 ? x.width : undefined,
      kind: x.kind === "number" ? "number" : "text",
      choices: x.choices as string[] | undefined,
      strict: x.strict === true,
      required: x.required === true,
      note: isText(x.note, 500) ? x.note : undefined,
    });
  }
  const width = columns.length;
  if (!(b.rows as unknown[]).every((r) => isRow(r, width))) return null;
  if (b.foot !== undefined && !isRow(b.foot, width)) return null;
  let template: SheetSpec["template"];
  if (b.template !== undefined) {
    const t = b.template as { help?: unknown };
    if (!t || !Array.isArray(t.help) || t.help.length > 40 || !t.help.every((l) => isText(l, 1000))) return null;
    template = { help: t.help as string[] };
  }
  return { name: b.name, title: b.title, columns, rows: b.rows as SheetSpec["rows"], foot: b.foot as SheetSpec["foot"], template };
}

/** A template to fill in, or what is on screen, as an Excel file. */
export async function POST(req: Request) {
  const stop = await sheetGuard(req);
  if (stop) return stop;
  const spec = specOf(await req.json().catch(() => null));
  if (!spec) return Response.json({ error: "Could not make the file." }, { status: 400 });
  const file = await writeSheet(spec);
  const name = `${spec.name.replace(/[^\p{L}\p{N} ._-]+/gu, "-").trim() || "sheet"}.xlsx`;
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new Response(new Uint8Array(file), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "private, no-store",
    },
  });
}
