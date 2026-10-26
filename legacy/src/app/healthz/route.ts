import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Container health check: the app is up, and the database and file storage answer. */
export async function GET() {
  const [database, files] = await Promise.all([
    db.execute(sql`select 1`).then(() => "ok", () => "error"),
    getStorage().check().then(() => "ok", () => "error"),
  ]);
  const ok = database === "ok" && files === "ok";
  return Response.json({ status: ok ? "ok" : "error", database, files }, { status: ok ? 200 : 503 });
}
