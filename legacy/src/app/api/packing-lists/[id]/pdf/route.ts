import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { isUuid } from "@/lib/utils/ids";
import { customerName } from "@/lib/utils/names";
import { getPackingListDetail } from "@/modules/packing/repository";
import { pdfResponse } from "@/lib/pdf/respond";

export const runtime = "nodejs";

/** The packing list as a PDF file, identical to its print page. `?view=1` opens it in the browser instead. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(user.role, "invoices.manage")) return new NextResponse("Forbidden", { status: 403 });
  const { id } = await params;
  const detail = isUuid(id) ? await getPackingListDetail(id) : null;
  if (!detail) return new NextResponse("Not found", { status: 404 });
  const pl = detail.packingList;
  return pdfResponse(request, {
    pagePath: `/print/packing-lists/${id}`,
    fileName: `${pl.plNo} ${customerName(detail.customer)}`,
    footerLabel: `Packing list ${pl.plNo}`,
  });
}
