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
