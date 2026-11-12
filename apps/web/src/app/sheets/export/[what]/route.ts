import { ApiError } from "@/lib/api";
import { ExportNotFound, EXPORTS, type ExportKind } from "@/lib/exports";
import { writeSheet } from "@/lib/sheets";
import { excelRefusal } from "../../guard";

/**
 * A list as an Excel file, with the filters on screen (?q=…&stage=…): every
 * row the person may see, not only the page shown. The API checks access.
 */
export async function GET(req: Request, { params }: { params: Promise<{ what: string }> }) {
  const { what } = await params;
  if (!Object.hasOwn(EXPORTS, what)) return new Response("Not found", { status: 404 });
  const refused = await excelRefusal();
  if (refused) return new Response("Excel is not in your company's plan.", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  const query: Record<string, string> = {};
  for (const [k, v] of new URL(req.url).searchParams) if (v && (v.length <= 200 || k === "ids") && k !== "format") query[k] = v;
  const csv = new URL(req.url).searchParams.get("format") === "csv";
  try {
    const specs = await EXPORTS[what as ExportKind](query);
    const first = Array.isArray(specs) ? specs[0]! : specs;
    // "Export CSV": the first sheet as comma-separated text (with a BOM, so Excel reads the letters right).
    if (csv) {
      const cell = (v: string | number | null) => {
        const t = v === null ? "" : String(v);
        return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
      };
      const lines = [first.columns.map((c) => cell(c.header)), ...first.rows.map((r) => r.map(cell)), ...(first.foot ? [first.foot.map(cell)] : [])];
      const name = `${first.name.replace(/[^\p{L}\p{N} ._()-]+/gu, "-").trim() || "export"}.csv`;
      return new Response(`\ufeff${lines.map((l) => l.join(",")).join("\r\n")}\r\n`, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"`,
          "cache-control": "private, no-store",
        },
      });
    }
    const file = await writeSheet(specs);
    const name = `${first.name.replace(/[^\p{L}\p{N} ._()-]+/gu, "-").trim() || "export"}.xlsx`;
    const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
    return new Response(new Uint8Array(file), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/[()'*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof ExportNotFound) return new Response("Not found", { status: 404 });
    if (e instanceof ApiError) {
      const msg = e.status === 401 ? "Sign in again, then export once more." : e.status === 403 ? "You cannot see this list." : e.message;
      return new Response(msg, { status: e.status, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    throw e;
  }
}
