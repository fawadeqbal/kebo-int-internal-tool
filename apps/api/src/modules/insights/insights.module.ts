import { Body, Controller, Get, HttpCode, Module, Param, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { isISODate, type ISODate } from "@kebo/utils";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { OrdersModule } from "../orders/orders.module";
import { MoneyModule } from "../money/money.module";
import { InsightsService } from "./insights.service";
import { RemindersListService } from "./reminders-list.service";

const date = z.string().refine(isISODate, "Use a valid date (YYYY-MM-DD)").optional();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month like 2026-10");
const key = z.object({ key: z.string().min(1).max(120) });

@ApiTags("insights")
@Controller()
class InsightsController {
  constructor(
    private readonly insights: InsightsService,
    private readonly reminders: RemindersListService,
  ) {}

  /** Managers: the business for a period (?from&to, default this month) against the period before. */
  @Get("insights")
  overview(@CurrentUser() user: SessionUser, @Query(Validate(z.object({ from: date, to: date }))) q: { from?: ISODate; to?: ISODate }) {
    return this.insights.overview(user, q);
  }

  @Get("insights/targets")
  targets(@CurrentUser() user: SessionUser, @Query(Validate(z.object({ year: z.coerce.number().int().min(2000).max(2100) }))) q: { year: number }) {
    return this.insights.targets(user, q.year);
  }

  /** { amount } in the main currency; 0 or null removes the month's target. */
  @Put("insights/targets/:month")
  setTarget(@CurrentUser() user: SessionUser, @Param("month") m: string, @Body(Validate(z.object({ amount: z.coerce.number().min(0).max(1e12).nullable() }))) body: { amount: number | null }) {
    return this.insights.setTarget(user, month.parse(m), body.amount);
  }

  /** What customers still owe, order by order (Money → To receive). */
  @Get("money/receivables")
  receivables(@CurrentUser() user: SessionUser) {
    return this.insights.receivables(user);
  }

  /** What needs me now ("Needs attention" on Home). */
  @Get("reminders")
  list(@CurrentUser() user: SessionUser) {
    return this.reminders.list(user);
  }

  @Post("reminders/snooze")
  @HttpCode(200)
  snooze(@CurrentUser() user: SessionUser, @Body(Validate(key.extend({ days: z.coerce.number().int().min(1).max(90) }))) body: { key: string; days: number }) {
    return this.reminders.snooze(user, body.key, body.days);
  }

  @Post("reminders/done")
  @HttpCode(200)
  done(@CurrentUser() user: SessionUser, @Body(Validate(key)) body: { key: string }) {
    return this.reminders.done(user, body.key);
  }

  @Post("reminders/restore")
  @HttpCode(200)
  restore(@CurrentUser() user: SessionUser, @Body(Validate(key)) body: { key: string }) {
    return this.reminders.restore(user, body.key);
  }
}

@Module({ imports: [OrdersModule, MoneyModule], controllers: [InsightsController], providers: [InsightsService, RemindersListService], exports: [InsightsService] })
export class InsightsModule {}
