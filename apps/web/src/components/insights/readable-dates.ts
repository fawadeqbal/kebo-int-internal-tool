import { formatDate, formatDayMonth, type TimeStyle } from "@kebo/utils";
import { timeStyle } from "@/lib/format";

/** "2026-11-04" → "04 Nov" (another year: "04 Nov 2025") in the reminders' words, the company's way (the API writes dates as ISO). */
export const readableDates = (text: string, style: TimeStyle = timeStyle()) =>
  text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (iso: string, y: string) => (Number(y) === new Date().getUTCFullYear() ? formatDayMonth(iso, style) : formatDate(iso, style)));
