import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { attachments } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { getStorage } from "@/lib/storage";
import { isUuid } from "@/lib/utils/ids";
import { getAccessibleQuery } from "@/modules/queries/service";
import { recordAudit } from "@/modules/audit/service";

const INLINE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"];

/** Download a file. Access is checked against the query it belongs to. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return new NextResponse("Not found", { status: 404 });
  const [file] = await db.select().from(attachments).where(and(eq(attachments.id, id), isNull(attachments.deletedAt))).limit(1);
  if (!file) return new NextResponse("Not found", { status: 404 });
  let refNo = "";
  try {
    refNo = (await getAccessibleQuery(user, file.queryId)).refNo;
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
  const view = new URL(request.url).searchParams.get("view") === "1";
  await recordAudit(db, { userId: user.id, action: view ? "view_file" : "download", entityType: "attachment", entityId: file.id, summary: `${view ? "Opened" : "Downloaded"} ${file.fileName} (${refNo})` });
  try {
    const stream = await getStorage().getStream(file.storageKey);
    const inline = new URL(request.url).searchParams.get("view") === "1" && INLINE_TYPES.includes(file.mimeType);
    return new NextResponse(stream, {
      headers: {
        "Content-Type": inline ? file.mimeType : "application/octet-stream",
        "Content-Length": String(file.size),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("File is missing from storage", { status: 410 });
  }
}
