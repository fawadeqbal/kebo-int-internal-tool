import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/token";
import { pdfHeaders, PdfUnavailableError, renderPdf } from "./index";

/** Render a print page as the current user and send it back as a PDF file. */
export async function pdfResponse(
  request: Request,
  { pagePath, fileName, footerLabel, landscape }: { pagePath: string; fileName: string; footerLabel: string; landscape?: boolean },
) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return new NextResponse("Unauthorized", { status: 401 });
  const inline = new URL(request.url).searchParams.get("view") === "1";
  try {
    const pdf = await renderPdf({ pagePath, sessionCookie: { name: SESSION_COOKIE, value: token }, footerLabel, landscape });
    return new NextResponse(Buffer.from(pdf), { headers: { ...pdfHeaders(fileName, inline), "Content-Length": String(pdf.byteLength) } });
  } catch (err) {
    if (err instanceof PdfUnavailableError) return new NextResponse(err.message, { status: 503 });
    console.error(`[pdf] ${pagePath} failed`, err);
    return new NextResponse("The PDF could not be created. Please try again, or use Print / Save as PDF.", { status: 500 });
  }
}
