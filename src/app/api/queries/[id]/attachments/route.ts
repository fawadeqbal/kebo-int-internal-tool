import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getStorage, isAllowedFile, MAX_UPLOAD_BYTES, safeFileName } from "@/lib/storage";
import { isUuid } from "@/lib/utils/ids";
import { canWorkOn, getAccessibleQuery, recordAttachment } from "@/modules/queries/service";
import { can } from "@/lib/auth/permissions";

/** Upload one or more files to a query (multipart/form-data, field "files"). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Query not found." }, { status: 404 });

  let query;
  try {
    query = await getAccessibleQuery(user, id);
  } catch {
    return NextResponse.json({ error: "Query not found." }, { status: 404 });
  }
  if (!canWorkOn(user, query) && !can(user.role, "queries.create"))
    return NextResponse.json({ error: "You cannot add files to this query." }, { status: 403 });

  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return NextResponse.json({ error: "Choose at least one file." }, { status: 400 });

  const problems: string[] = [];
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) problems.push(`${file.name} is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
    else if (!isAllowedFile(file.name)) problems.push(`${file.name} is not an allowed file type.`);
  }
  if (problems.length) return NextResponse.json({ error: problems.join(" ") }, { status: 400 });

  const storage = getStorage();
  const saved = [];
  for (const file of files) {
    const name = safeFileName(file.name);
    const key = `queries/${id}/${randomUUID()}-${name}`;
    await storage.put(key, Buffer.from(await file.arrayBuffer()), file.type);
    saved.push(await recordAttachment(user, id, { fileName: name, mimeType: file.type || "application/octet-stream", size: file.size, storageKey: key }));
  }
  return NextResponse.json({ ok: true, count: saved.length });
}
