import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import { counters } from "@/lib/db/schema";

/**
 * Next reference number for a prefix and year, e.g. QRY-2026-0001.
 * The atomic upsert makes numbers sequential and never reused, even under concurrency.
 */
export async function nextReference(tx: DbOrTx, prefix: string, year = new Date().getFullYear()): Promise<string> {
  const key = `${prefix}-${year}`;
  const [row] = await tx
    .insert(counters)
    .values({ key, value: 1 })
    .onConflictDoUpdate({ target: counters.key, set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value });
  return `${key}-${String(row.value).padStart(4, "0")}`;
}
