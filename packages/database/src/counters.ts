import { counterKey, formatReference, type DocumentKind } from "@kebo/utils";
import type { Db } from "./client";

/**
 * Takes the next `by` numbers of a company counter and returns the last one taken
 * (the first is that minus `by` plus one). Every number the company gives out
 * (references, receipts, proformas, statements, ledger entries) comes from here:
 * one atomic INSERT … ON CONFLICT, so two people saving at once never get the
 * same number, and inside a transaction a rolled-back save gives its numbers back.
 */
export async function nextCount(db: Pick<Db, "$queryRaw">, key: string, by = 1): Promise<number> {
  const rows = await db.$queryRaw<{ value: number }[]>`
    insert into counters (key, value) values (${key}, ${by})
    on conflict (company_id, key) do update set value = counters.value + ${by}
    returning value`;
  return rows[0]!.value;
}

/** Marks a once-only job done (a day's summary email): true for the first caller only. */
export async function claimOnce(db: Pick<Db, "$executeRaw">, key: string): Promise<boolean> {
  return (await db.$executeRaw`insert into counters (key, value) values (${key}, 1) on conflict do nothing`) > 0;
}

/**
 * The next document number (RFQ-2026-0001, SO-2026-0001…). The year is the
 * business year (pass it from today in the business time zone), so numbers
 * issued around New Year carry the right one.
 */
export async function nextReference(db: Pick<Db, "$queryRaw">, kind: DocumentKind, year: number): Promise<string> {
  return formatReference(kind, year, await nextCount(db, counterKey(kind, year)));
}
