import { counterKey, formatReference, type DocumentKind } from "@kebo/utils";
import type { Db } from "./client";

/**
 * The next document number (RFQ-2026-0001, SO-2026-0001…). One atomic
 * INSERT … ON CONFLICT statement, so two people saving at once never get the
 * same number, and inside a transaction a rolled-back save gives its number back.
 */
export async function nextReference(db: Db, kind: DocumentKind, year = new Date().getFullYear()): Promise<string> {
  const key = counterKey(kind, year);
  const rows = await db.$queryRaw<{ value: number }[]>`
    insert into counters (key, value) values (${key}, 1)
    on conflict (key) do update set value = counters.value + 1
    returning value`;
  return formatReference(kind, year, rows[0].value);
}
