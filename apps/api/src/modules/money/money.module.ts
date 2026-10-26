import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  expenseInput,
  factoryPaymentInput,
  paymentPlanInput,
  voidInput,
  type ExpenseInput,
  type FactoryPaymentInput,
  type PaymentPlanInput,
} from "@kebo/shared";
import { isISODate } from "@kebo/utils";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { OrdersModule } from "../orders/orders.module";
import { MoneyService } from "./money.service";

const date = z.string().refine(isISODate, "Use a valid date (YYYY-MM-DD)").optional();
const expenseQuery = z.object({ from: date, to: date, orderId: z.uuid().optional(), kind: z.enum(["order", "general"]).optional() });
const yearQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100) });
const flag = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");

@ApiTags("money")
@Controller()
class MoneyController {
  constructor(private readonly money: MoneyService) {}

  /** An order's money: payment plan, what we owe and paid factories, expenses and profit (each for the people who may see it). */
  @Get("orders/:id/money")
  forOrder(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.money.forOrder(user, id);
  }

  /** { items: [{ id?, label, amount, dueOn? }], reason? } — they must add up to the order total. */
  @Put("orders/:id/payment-plan")
  plan(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(paymentPlanInput)) body: PaymentPlanInput) {
    return this.money.setPlan(user, id, body);
  }

  @Post("orders/:id/factory-payments")
  payFactory(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(factoryPaymentInput)) body: FactoryPaymentInput,
  ) {
    return this.money.recordFactoryPayment(user, id, body);
  }

  /** Same body as recording, plus reason (always asked). */
  @Patch("factory-payments/:id")
  editFactoryPayment(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(factoryPaymentInput)) body: FactoryPaymentInput,
  ) {
    return this.money.editFactoryPayment(user, id, body);
  }

  @Post("factory-payments/:id/void")
  @HttpCode(200)
  voidFactoryPayment(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(voidInput)) body: z.infer<typeof voidInput>,
  ) {
    return this.money.voidFactoryPayment(user, id, body.reason);
  }

  /** What we still owe each factory on orders not cancelled. ?mine=true: the factories I look after. */
  @Get("money/payables")
  payables(@CurrentUser() user: SessionUser, @Query(Validate(z.object({ mine: flag }))) q: { mine: boolean }) {
    return this.money.payables(user, q.mine);
  }

  /** Managers only. ?from&to (dates), ?orderId, ?kind=order|general */
  @Get("expenses")
  expenses(@CurrentUser() user: SessionUser, @Query(Validate(expenseQuery)) q: z.infer<typeof expenseQuery>) {
    return this.money.listExpenses(user, q);
  }

  @Post("expenses")
  createExpense(@CurrentUser() user: SessionUser, @Body(Validate(expenseInput)) body: ExpenseInput) {
    return this.money.createExpense(user, body);
  }

  /** Same body as adding, plus reason (always asked). */
  @Patch("expenses/:id")
  editExpense(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(expenseInput)) body: ExpenseInput) {
    return this.money.editExpense(user, id, body);
  }

  @Post("expenses/:id/void")
  @HttpCode(200)
  voidExpense(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(voidInput)) body: z.infer<typeof voidInput>,
  ) {
    return this.money.voidExpense(user, id, body.reason);
  }

  /** Managers only: the year month by month, earned and cash, in the main currency. */
  @Get("money/profit-and-loss")
  pnl(@CurrentUser() user: SessionUser, @Query(Validate(yearQuery)) q: z.infer<typeof yearQuery>) {
    return this.money.profitAndLoss(user, q.year);
  }
}

@Module({ imports: [OrdersModule], controllers: [MoneyController], providers: [MoneyService], exports: [MoneyService] })
export class MoneyModule {}
