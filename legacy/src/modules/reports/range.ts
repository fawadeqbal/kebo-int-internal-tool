import { addDaysISO, todayISO } from "@/lib/utils/dates";
import type { Range } from "./repository";

export const PRESETS = {
  month: "This month",
  last_month: "Last month",
  "90d": "Last 90 days",
  year: "This year",
  custom: "Custom",
} as const;

export type Preset = keyof typeof PRESETS;

/** Resolve a preset or custom from/to into a date range. */
export function resolveRange(preset?: string, from?: string, to?: string): Range & { preset: Preset } {
  const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (preset === "custom" && isDate(from) && isDate(to))
    return from! <= to! ? { from: from!, to: to!, preset: "custom" } : { from: to!, to: from!, preset: "custom" };
  return presetRange(preset);
}

function presetRange(preset?: string): Range & { preset: Preset } {
  const today = todayISO();
  if (preset === "last_month") {
    const first = new Date(`${today.slice(0, 8)}01T00:00:00Z`);
    first.setUTCMonth(first.getUTCMonth() - 1);
    const start = first.toISOString().slice(0, 10);
    const end = addDaysISO(`${today.slice(0, 8)}01`, -1);
    return { from: start, to: end, preset };
  }
  if (preset === "90d") return { from: addDaysISO(today, -89), to: today, preset };
  if (preset === "year") return { from: `${today.slice(0, 4)}-01-01`, to: today, preset };
  return { from: `${today.slice(0, 8)}01`, to: today, preset: "month" };
}
