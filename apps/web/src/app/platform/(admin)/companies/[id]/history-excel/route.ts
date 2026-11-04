import { COMPANY_LOG_KINDS, companyLogKind, type CompanyLogKind } from "@kebo/shared";
import { ApiError, platformApi } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { writeSheet } from "@/lib/sheets";
import type { CompanyDetail, CompanyHistory } from "@/lib/types-platform";

const KIND = (k: string) => (k in COMPANY_LOG_KINDS ? COMPANY_LOG_KINDS[k as CompanyLogKind].label : "Other");

/** The company's history as an Excel file (History → Excel), with the kind chosen on screen (?kind=). The API checks it is a platform admin. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const kind = new URL(req.url).searchParams.get("kind") ?? "";
  try {
    const [c, h] = await Promise.all([
      platformApi.get<CompanyDetail>(`/companies/${id}`),
      platformApi.get<CompanyHistory>(`/companies/${id}/history`, kind ? { kind } : undefined),
    ]);
    const name = `${c.slug} history${h.kind ? ` (${KIND(h.kind).toLowerCase()})` : ""}`;
    const file = await writeSheet({
      name,
      title: "Company history",
      columns: [
        { header: "When", width: 20 },
        { header: "Kind", width: 18 },
        { header: "What", width: 80 },
        { header: "Who", width: 24 },
      ],
      rows: h.rows.map((r) => [dateTime(r.at), KIND(companyLogKind(r.action)), r.summary, r.adminName ?? "Automatic rules"]),
    });
    const ascii = `${name}.xlsx`.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
    return new Response(new Uint8Array(file), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${ascii}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof ApiError) {
      const msg = e.status === 401 ? "Sign in again, then export once more." : e.message;
      return new Response(msg, { status: e.status, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    throw e;
  }
}
