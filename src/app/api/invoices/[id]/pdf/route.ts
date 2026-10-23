import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { isUuid } from "@/lib/utils/ids";
import { customerName } from "@/lib/utils/names";
import { getInvoiceDetail } from "@/modules/invoices/repository";
import { pdfResponse } from "@/lib/pdf/respond";

export const runtime = "nodejs";

/** The invoice as a PDF file, identical to its print page. `?view=1` opens it in the browser instead. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(user.role, "invoices.manage")) return new NextResponse("Forbidden", { status: 403 });
  const { id } = await params;
  const detail = isUuid(id) ? await getInvoiceDetail(id) : null;
  if (!detail) return new NextResponse("Not found", { status: 404 });
  const inv = detail.invoice;
  return pdfResponse(request, {
    pagePath: `/print/invoices/${id}`,
    fileName: `${inv.invoiceNo} ${customerName(detail.customer)}`,
    footerLabel: `Invoice ${inv.invoiceNo}`,
  });
}
