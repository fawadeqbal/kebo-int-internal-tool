import { todayIn } from "@kebo/utils";

/**
 * Dates for tests, counted from today where the company is. A test must not
 * carry a calendar date that the real calendar will pass: it fails on that day.
 */
export const today = todayIn(process.env.APP_TIME_ZONE ?? "Asia/Shanghai");

/** The day n days from today (negative: before today), as YYYY-MM-DD. */
export const day = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
