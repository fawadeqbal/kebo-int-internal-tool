import { formatDateTime } from "@/lib/utils/dates";

/** Most rows a PDF holds; beyond that the CSV export is the better tool. */
export const PDF_ROW_LIMIT = 2000;

export const generatedNow = () => formatDateTime(new Date());

export function limitNote(shown: number, total: number) {
  return total > shown ? `Showing the first ${shown.toLocaleString("en")} of ${total.toLocaleString("en")} records. Narrow the filters, or use the CSV export for everything.` : undefined;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;
