import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { can, type Permission } from "@/lib/auth/permissions";
import { pdfResponse } from "@/lib/pdf/respond";
import { todayISO } from "@/lib/utils/dates";

export const runtime = "nodejs";

/** Every list export: what it is called, who may download it, and its paper orientation. */
const EXPORTS: Record<string, { title: string; permission?: Permission; landscape: boolean }> = {
  inquiries: { title: "Inquiries", landscape: true },
  customers: { title: "Customers", landscape: false },
  quotations: { title: "Quotations", landscape: true },
  invoices: { title: "Invoices", permission: "invoices.manage", landscape: true },
  audit: { title: "Audit log", permission: "audit.view", landscape: true },
  reports: { title: "Business report", permission: "reports.view", landscape: false },
};

/**
 * A formatted PDF report of a list, with the same filters as the screen
 * (`/api/export/invoices/pdf?status=overdue`). `?view=1` opens it in the browser.
 */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { kind } = await params;
  const spec = EXPORTS[kind];
  if (!spec) return new NextResponse("Not found", { status: 404 });
  if (spec.permission && !can(user.role, spec.permission)) return new NextResponse("Forbidden", { status: 403 });

  const query = new URL(request.url).searchParams;
  query.delete("view");
  query.delete("page");
  const qs = query.toString();
  return pdfResponse(request, {
    pagePath: `/print/export/${kind}${qs ? `?${qs}` : ""}`,
    fileName: `${spec.title} ${todayISO()}`,
    footerLabel: `${spec.title} · generated ${todayISO()} by ${user.name}`,
    landscape: spec.landscape,
  });
}
