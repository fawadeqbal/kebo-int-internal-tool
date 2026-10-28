import { readSheet, SheetError } from "@/lib/sheets";
import { SHEET_LIMITS } from "@/lib/sheet-spec";
import { sheetGuard } from "../guard";

/**
 * Reads an uploaded Excel or CSV file and returns its headings and rows as
 * text. Nothing is saved: the page shows the rows to check, and saves them
 * the way it saves rows typed by hand.
 */
export async function POST(req: Request) {
  const stop = await sheetGuard(req);
  if (stop) return stop;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Choose a file to upload." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: "Choose a file to upload." }, { status: 400 });
  if (file.size > SHEET_LIMITS.bytes) return Response.json({ error: "The file is over 5 MB. Upload fewer rows at a time." }, { status: 413 });
  try {
    return Response.json(await readSheet(await file.arrayBuffer(), file.name), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof SheetError) return Response.json({ error: e.message }, { status: 422 });
    throw e;
  }
}
