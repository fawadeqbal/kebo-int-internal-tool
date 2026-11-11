import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, RequireFeature } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { InsightsService } from "./insights.service";
import { RemindersListService } from "./reminders-list.service";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month like 2026-10");
const key = z.object({ key: z.string().min(1).max(120) });

@ApiTags("insights")
@Controller()
export class InsightsController {
  constructor(
    private readonly insights: InsightsService,
    private readonly reminders: RemindersListService,
  ) {}

  /** Managers: this month's company target and how far along it is (Home), from Insights' sales. */
  @RequireFeature("insights")
  @Get("insights/target")
  monthTarget(@CurrentUser() user: SessionUser) {
    return this.insights.monthTarget(user);
  }

  @RequireFeature("insights")
  @Get("insights/targets")
  targets(@CurrentUser() user: SessionUser, @Query(Validate(z.object({ year: z.coerce.number().int().min(2000).max(2100) }))) q: { year: number }) {
    return this.insights.targets(user, q.year);
  }

  /** { amount } in the main currency; 0 or null removes the month's target. */
  @RequireFeature("insights")
  @Put("insights/targets/:month")
  setTarget(@CurrentUser() user: SessionUser, @Param("month") m: string, @Body(Validate(z.object({ amount: z.coerce.number().min(0).max(1e12).nullable() }))) body: { amount: number | null }) {
    return this.insights.setTarget(user, month.parse(m), body.amount);
  }

  /** Targets per person for a year, with the people to set them for. */
  @RequireFeature("insights")
  @Get("insights/targets/people")
  personTargets(@CurrentUser() user: SessionUser, @Query(Validate(z.object({ year: z.coerce.number().int().min(2000).max(2100) }))) q: { year: number }) {
    return this.insights.personTargets(user, q.year);
  }

  /** { amount } in the main currency for one person and month; 0 or null removes it. */
  @RequireFeature("insights")
  @Put("insights/targets/:month/people/:userId")
  setPersonTarget(
    @CurrentUser() user: SessionUser,
    @Param("month") m: string,
    @Param("userId", ParseUUIDPipe) userId: string,
    @Body(Validate(z.object({ amount: z.coerce.number().min(0).max(1e12).nullable() }))) body: { amount: number | null },
  ) {
    return this.insights.setPersonTarget(user, month.parse(m), userId, body.amount);
  }

  /** My own target this month and how far I am. */
  @RequireFeature("insights")
  @Get("me/target")
  myTarget(@CurrentUser() user: SessionUser) {
    return this.insights.myTarget(user);
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
