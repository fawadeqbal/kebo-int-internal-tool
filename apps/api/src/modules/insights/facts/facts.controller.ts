import { Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { isISODate } from "@kebo/utils";
import { Validate } from "../../../common/http/zod.pipe";
import { CurrentUser, RequireFeature } from "../../../common/auth/decorators";
import type { SessionUser } from "../../../common/auth/session-user";
import { FACTORY_GROUPS, FactsReadService, ORDER_GROUPS, PERIODS } from "./facts-read.service";

const date = z.string().refine(isISODate, "Use a valid date (YYYY-MM-DD)").optional();
const id = z.string().uuid().optional();
const span = { from: date, to: date };
const filters = {
  customerId: id,
  personId: z.union([z.string().uuid(), z.literal("nobody")]).optional(),
  channel: z.string().max(20).optional(),
  country: z.string().length(2).optional(),
  category: z.string().max(120).optional(),
  factoryId: id,
};
const period = z.enum(PERIODS).default("month");
const orderQuery = z.object({ ...span, ...filters, period, by: z.enum(ORDER_GROUPS).default("company") });
const inquiryQuery = orderQuery.extend({ on: z.enum(["received", "closed"]).default("received") });
const factoryQuery = z.object({ ...span, factoryId: id, period, by: z.enum(FACTORY_GROUPS).default("factory") });
const agingQuery = z.object({
  side: z.enum(["receivable", "payable"]).default("receivable"),
  bucket: z.enum(["notDue", "d30", "d60", "d90", "older"]).optional(),
  customerId: id,
  factoryId: id,
});
const rowsQuery = z.object({ ...span, ...filters, limit: z.coerce.number().int().min(1).max(1000).optional() });

/**
 * Insights data (PR B): the three calculated tables, read for the Insights screens (PR F) and for Home,
 * Reports and Leaks (PR G). Money figures only with the money permission, as Insights.
 */
@ApiTags("insights")
@Controller("insights/facts")
export class FactsController {
  constructor(private readonly read: FactsReadService) {}

  /** Orders added up per period × group: ?from&to&period=month|quarter|year|all&by=company|customer|person|channel|country|category (+ filters). */
  @RequireFeature("insights")
  @Get("orders/groups")
  orderGroups(@CurrentUser() user: SessionUser, @Query(Validate(orderQuery)) q: z.infer<typeof orderQuery>) {
    return this.read.orderGroups(user, q);
  }

  /** Inquiries per period × group, dated by when they came in (on=received) or were decided (on=closed). */
  @RequireFeature("insights")
  @Get("inquiries/groups")
  inquiryGroups(@CurrentUser() user: SessionUser, @Query(Validate(inquiryQuery)) q: z.infer<typeof inquiryQuery>) {
    return this.read.inquiryGroups(user, q);
  }

  /** From inquiry to order for a span: stages, values, why we lose, medians. */
  @RequireFeature("insights")
  @Get("funnel")
  funnel(@CurrentUser() user: SessionUser, @Query(Validate(z.object({ ...span, ...filters }))) q: z.infer<z.ZodObject<typeof span & typeof filters>>) {
    return this.read.funnel(user, q);
  }

  /** Factories per period × group (by=factory|company): spend, to pay, ready on time, offers won of sent, claims. */
  @RequireFeature("insights")
  @Get("factories/groups")
  factoryGroups(@CurrentUser() user: SessionUser, @Query(Validate(factoryQuery)) q: z.infer<typeof factoryQuery>) {
    return this.read.factoryGroups(user, q);
  }

  /** Owed to us (side=receivable) or to factories (side=payable) by age today; bucket= lists its orders. */
  @RequireFeature("insights")
  @Get("aging")
  aging(@CurrentUser() user: SessionUser, @Query(Validate(agingQuery)) q: z.infer<typeof agingQuery>) {
    return this.read.aging(user, q);
  }

  /** Cash in and out by month, straight from payments, factory payments and expenses; expenses by kind. */
  @RequireFeature("insights")
  @Get("cash")
  cash(@CurrentUser() user: SessionUser, @Query(Validate(z.object(span))) q: z.infer<z.ZodObject<typeof span>>) {
    return this.read.cash(user, q);
  }

  /** What stands today and needs attention: open quotations, expiring ones, overdue customers, late factories, low margins. */
  @RequireFeature("insights")
  @Get("now")
  now(@CurrentUser() user: SessionUser, @Query(Validate(z.object(span))) q: z.infer<z.ZodObject<typeof span>>) {
    return this.read.now(user, q);
  }

  /** The order rows themselves, newest first (drill-down and Excel). */
  @RequireFeature("insights")
  @Get("orders")
  orders(@CurrentUser() user: SessionUser, @Query(Validate(rowsQuery)) q: z.infer<typeof rowsQuery>) {
    return this.read.orders(user, q);
  }

  /** When the tables were last worked out and what is still queued. */
  @RequireFeature("insights")
  @Get("status")
  status(@CurrentUser() user: SessionUser) {
    return this.read.status(user);
  }

  /** Work everything out again now and say what differed (also done every night by the worker). */
  @RequireFeature("insights")
  @Post("rebuild")
  @HttpCode(200)
  rebuild(@CurrentUser() user: SessionUser) {
    return this.read.rebuild(user);
  }
}
