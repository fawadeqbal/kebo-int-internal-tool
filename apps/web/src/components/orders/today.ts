import "server-only";
import { companyToday } from "@/lib/format";

/** Today, company time (YYYY-MM-DD), for the default date of a form. */
export function today(): string {
  return companyToday();
}
