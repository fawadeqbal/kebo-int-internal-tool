import { fromMinor, toMinor, type Minor } from "@kebo/money";
import type { ISODate } from "@kebo/utils";

/**
 * DATE columns arrive as JavaScript Dates at midnight UTC. The app works with
 * "YYYY-MM-DD" strings for calendar dates, so these two functions are the only
 * place the conversion happens.
 */
export const toDbDate = (iso: ISODate): Date => new Date(`${iso}T00:00:00.000Z`);
export const fromDbDate = (d: Date): ISODate => d.toISOString().slice(0, 10);
export const toDbDateOrNull = (iso: ISODate | null | undefined): Date | null => (iso ? toDbDate(iso) : null);
export const fromDbDateOrNull = (d: Date | null | undefined): ISODate | null => (d ? fromDbDate(d) : null);

/** Decimal columns ↔ integer minor units. */
export const decimalToMinor = (d: { toString(): string } | null | undefined): Minor => toMinor(d);
export const minorToDecimal = (m: Minor): string => fromMinor(m);
