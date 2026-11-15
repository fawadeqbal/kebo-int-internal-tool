import { Inject, Injectable } from "@nestjs/common";
import { hourIn, todayIn, type ISODate, type TimeStyle } from "@kebo/utils";
import { ENV, type Env } from "../../config/env";
import { CompanyContext } from "../company/company-context";

/**
 * "Today" and the time of day, in the company's time zone (Company settings › Time and dates): every date the
 * company works with (due, late, reminders, reports, papers) and every time it is shown is in it. Outside a
 * company (the platform's own work) and for a company that has not chosen one: the server's (APP_TIME_ZONE).
 * The one place the API reads a time zone; injected so tests can fix the date.
 */
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
    const c = CompanyContext.current();
    return { zone: this.timeZone, date: c?.dateFormat ?? "d_mmm_yyyy", time: c?.timeFormat ?? "24h" };
  }

  /** The server's own zone: the platform's work (backups, server checks, platform emails), never a company's. */
  get serverZone(): string {
    return this.env.APP_TIME_ZONE;
  }
}
