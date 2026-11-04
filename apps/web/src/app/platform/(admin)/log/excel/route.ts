import { PLATFORM_LOG_KINDS, platformLogKind, type PlatformLogKind } from "@kebo/shared";
import { ApiError, platformApi } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { writeSheet } from "@/lib/sheets";
import type { LogEntry, LogPage } from "@/lib/types-platform";

const kindLabel = (k: string) => (k in PLATFORM_LOG_KINDS ? PLATFORM_LOG_KINDS[k as PlatformLogKind].label : "Other");

/** The platform log as an Excel file, with the search and kind on screen (?q=, ?kind=); at most 5,000 rows. The API checks it is a platform admin. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? undefined;
  const kind = url.searchParams.get("kind") ?? undefined;
  try {
    const rows: LogEntry[] = [];
    for (let page = 1; page <= 200 && rows.length < 5000; page++) {
      const p = await platformApi.get<LogPage>("/log", { q, kind, page: String(page) });
      rows.push(...p.rows);
      if (page * p.pageSize >= p.total) break;
    }
    const name = `platform log${kind ? ` (${kindLabel(kind).toLowerCase()})` : ""}`;
    const file = await writeSheet({
      name,
      title: "Platform log",
      columns: [
        { header: "When", width: 20 },
        { header: "Who", width: 24 },
        { header: "Kind", width: 18 },
        { header: "What", width: 90 },
      ],
      rows: rows.map((r) => [dateTime(r.at), r.adminName ?? "Automatic rules", kindLabel(platformLogKind(r.action)), r.summary]),
    });
    return new Response(new Uint8Array(file), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}.xlsx"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof ApiError)
      return new Response(e.status === 401 ? "Sign in again, then export once more." : e.message, {
        status: e.status,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    throw e;
  }
}
