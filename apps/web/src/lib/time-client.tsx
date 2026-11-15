"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { formatClock, formatDate, formatDateTime, formatDayMonth, formatTime, hourIn, timeAgo, todayIn, type ISODate, type TimeStyle } from "@kebo/utils";
import { setCompanyTime, timeStyle } from "./format";

const CompanyTimeContext = createContext<TimeStyle | null>(null);

/**
 * The company's time for everything in the browser (the app's layout puts it around every page): its zone and
 * how it writes dates and times. Client components read it with useTime(), so the server's render and the
 * browser's agree; plain helpers in lib/format read it too once the page is in the browser.
 */
export function CompanyTime({ style, children }: { style: TimeStyle; children: ReactNode }) {
  setCompanyTime(style);
  return <CompanyTimeContext.Provider value={style}>{children}</CompanyTimeContext.Provider>;
}

type Day = ISODate | Date | string | null | undefined;

/** The company's time in a client component: today, the hour, and dates and times written the company's way. */
export function useTime() {
  const s = useContext(CompanyTimeContext) ?? timeStyle();
  return useMemo(
    () => ({
      style: s,
      zone: s.zone,
      today: () => todayIn(s.zone),
      hour: () => hourIn(s.zone),
      date: (d: Day) => formatDate(d ?? null, s),
      dayMonth: (d: Day) => formatDayMonth(d ?? null, s),
      dateTime: (d: Date | string | null | undefined) => formatDateTime(d ?? null, s),
      time: (d: Date | string | null | undefined) => formatTime(d ?? null, s),
      clockTime: (hhmm: string | null | undefined) => formatClock(hhmm, s),
      timeAgo: (d: Date | string) => timeAgo(d, s),
    }),
    [s],
  );
}
