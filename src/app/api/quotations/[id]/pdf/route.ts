import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { isUuid } from "@/lib/utils/ids";
import { customerName } from "@/lib/utils/names";
import { getQuotationDetail } from "@/modules/quotations/repository";
import { pdfResponse } from "@/lib/pdf/respond";

export const runtime = "nodejs";

/** The quotation as a PDF file, identical to its print page. `?view=1` opens it in the browser instead. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  const detail = isUuid(id) ? await getQuotationDetail(user, id) : null;
  if (!detail) return new NextResponse("Not found", { status: 404 });
  const q = detail.quotation;
  const version = q.version > 1 ? ` v${q.version}` : "";
  return pdfResponse(request, {
    pagePath: `/print/quotations/${id}`,
    fileName: `${q.refNo}${version} ${customerName(detail.customer)}`,
    footerLabel: `Quotation ${q.refNo}${version}`,
  });
}
