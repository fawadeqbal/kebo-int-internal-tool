import { formatDate, formatDayMonth, todayIn, type TimeStyle } from "@kebo/utils";
import { timeStyle } from "@/lib/format";

/**
 * Every "2026-11-04" in a text written the company's way: "04 Nov" this year, "04 Nov 2025" another (the API
 * writes days as ISO in what it records: history, reminders, messages).
 */
export const readableDates = (text: string, style: TimeStyle = timeStyle()) => {
  const year = todayIn(style.zone).slice(0, 4);
  return text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (iso: string, y: string) => (y === year ? formatDayMonth(iso, style) : formatDate(iso, style)));
};

/** A record's id written into a sentence (a history line's "Follow up — → 7f8c…"): not for people. */
const ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * What a history line says, for people (live audit 20 Nov): its days written the company's way, its amounts with
 * their thousands ("4400000.00" → "4,400,000.00"; years and numbers like RFQ-2026-0011 are left alone), and any
 * " · Field — → <id>" part, which only names an id, left out.
 */
export const readableHistory = (text: string, style: TimeStyle = timeStyle()) =>
  readableDates(text, style)
    .split(" · ")
    .filter((part) => !ID.test(part))
    .join(" · ")
    .replace(/(?<![\w./:-])(\d{5,}(?:\.\d{1,2})?|\d{4}\.\d{1,2})(?![\w/:-])/g, (n) => {
      const [whole, cents] = n.split(".");
      return Number(whole).toLocaleString("en-US") + (cents !== undefined ? `.${cents}` : "");
    });
