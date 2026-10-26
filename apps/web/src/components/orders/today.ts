import "server-only";

/** Today in the business time zone (YYYY-MM-DD), for the default date of a form. */
export function today(): string {
  const tz = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}
