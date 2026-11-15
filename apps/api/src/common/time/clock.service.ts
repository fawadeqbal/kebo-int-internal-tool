import { Inject, Injectable } from "@nestjs/common";
import { DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT, formatDate, formatDayMonth, hourIn, todayIn, type ISODate, type TimeStyle } from "@kebo/utils";
import { ENV, type Env } from "../../config/env";
import { CompanyContext } from "../company/company-context";

/**
 * "Today" and the time of day, in the company's time zone (Company settings › Time and dates): every date the
 * company works with (due, late, reminders, reports, papers) and every time it is shown is in it. Outside a
 * company (the platform's own work) and for a company that has not chosen one: the server's (APP_TIME_ZONE).
 * The one place the API reads a time zone; injected so tests can fix the date.
 */
/** How the company writes dates and times (its Time and dates settings); the usual way outside a company. */
export function companyFormats(): Omit<TimeStyle, "zone"> {
  const c = CompanyContext.current();
  return { date: c?.dateFormat ?? DEFAULT_DATE_FORMAT, time: c?.timeFormat ?? DEFAULT_TIME_FORMAT };
}

/** A calendar day ("2026-11-14") as the company writes it: "14 Nov 2026", "14/11/2026"… */
export const companyDay = (iso: ISODate) => formatDate(iso, { zone: "UTC", ...companyFormats() });

/** A calendar day without its year, as the company writes it: "14 Nov", "14/11"… */
export const companyDayMonth = (iso: ISODate) => formatDayMonth(iso, { zone: "UTC", ...companyFormats() });

@Injectable()
export class Clock {
  constructor(@Inject(ENV) private readonly env: Env) {}

  now(): Date {
    return new Date();
  }

  today(): ISODate {
    return todayIn(this.timeZone, this.now());
  }

  /** The hour of the day now (0–23), company time. */
  hour(): number {
    return hourIn(this.timeZone, this.now());
  }

  get timeZone(): string {
    return CompanyContext.current()?.timeZone ?? this.env.APP_TIME_ZONE;
  }

  /** The company's zone and how it writes dates and times (emails, papers, messages). */
  get style(): TimeStyle {
    return { zone: this.timeZone, ...companyFormats() };
  }

  /** The server's own zone: the platform's work (backups, server checks, platform emails), never a company's. */
  get serverZone(): string {
    return this.env.APP_TIME_ZONE;
  }
}
