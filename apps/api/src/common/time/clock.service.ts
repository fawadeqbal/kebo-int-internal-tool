import { Inject, Injectable } from "@nestjs/common";
import { todayIn, type ISODate } from "@kebo/utils";
import { ENV, type Env } from "../../config/env";

/** "Today" in the business time zone; injected so tests can fix the date. */
@Injectable()
export class Clock {
  constructor(@Inject(ENV) private readonly env: Env) {}

  now(): Date {
    return new Date();
  }

  today(): ISODate {
    return todayIn(this.env.APP_TIME_ZONE, this.now());
  }

  get timeZone() {
    return this.env.APP_TIME_ZONE;
  }
}
