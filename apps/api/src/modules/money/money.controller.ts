import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  EXPENSE_CATEGORIES,
  expenseInput,
  factoryPaymentInput,
  type FactoryPaymentInput,
  factoryPlanInput,
  type FactoryPlanInput,
  paymentPlanInput,
  repayInput,
  voidInput,
  type RepayInput,
  type ExpenseInput,
  type PaymentPlanInput,
} from "@kebo/shared";
import { isISODate } from "@kebo/utils";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, RequireFeature, RequirePermissions, SignedIn } from "../../common/auth/decorators";
import { LimitsService } from "../../common/company/limits.service";
import type { SessionUser } from "../../common/auth/session-user";
import { MoneyService } from "./money.service";
import { BillingService } from "../billing/billing.service";
import { SupplierPaymentsService } from "../treasury/supplier-payments.service";
import { CostsService } from "./costs.service";
import { AccountsService } from "./accounts.service";
import { LeaksService } from "./leaks.service";
import { Once } from "../../common/http/once";

const date = z.string().refine(isISODate, "Use a valid date (YYYY-MM-DD)").optional();
const expenseQuery = z.object({
  from: date,
  to: date,
  orderId: z.uuid().optional(),
  inquiryId: z.uuid().optional(),
  factoryId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  kind: z.enum(["order", "customer", "general", "company"]).optional(),
  /** What it was for, the note or who was paid. */
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});
const MAX_UPLOAD = 200 * 1024 * 1024; // hard ceiling; the configured limit is checked in the service
const yearQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100) });

@ApiTags("money")
@Controller()
export class MoneyController {
  constructor(
    private readonly money: MoneyService,
    private readonly billing: BillingService,
    private readonly supplierPayments: SupplierPaymentsService,
    private readonly costs: CostsService,
    private readonly accounts: AccountsService,
    private readonly leaks: LeaksService,
    private readonly limits: LimitsService,
  ) {}

  /** Managers: where we lose money in a period (?from&to, default this year), with warnings. */
  @RequireFeature("insights")
  @SignedIn("checked inside: expenses.manage, reports.view")
  @Get("reports/leaks")
  leaksReport(@CurrentUser() user: SessionUser, @Query(Validate(z.object({ from: date, to: date }))) q: { from?: string; to?: string }) {
    return this.leaks.report(user, q);
  }

  /** Managers only: the bills known and not paid yet, and the people to pay back, across the company. */
  @RequireFeature("expenses")
  @SignedIn("checked inside: expenses.manage")
  @Get("money/bills")
  openBills(@CurrentUser() user: SessionUser) {
    return this.money.openBills(user);
  }

  /** Managers only: the company's costs that come every month and are not in this month yet. */
  @RequireFeature("expenses")
  @SignedIn("checked inside: expenses.manage")
  @Get("expenses/repeating")
  repeating(@CurrentUser() user: SessionUser) {
    return this.money.repeatingCosts(user);
  }

  /** { what: skip | stop }: skip this month's, or stop the cost from repeating. */
  @RequireFeature("expenses")
  @SignedIn("checked inside: expenses.manage")
  @Post("expenses/repeating/:key")
  @HttpCode(200)
  repeatingChange(@CurrentUser() user: SessionUser, @Param("key", ParseUUIDPipe) key: string, @Body(Validate(z.object({ what: z.enum(["skip", "stop"]) }))) body: { what: "skip" | "stop" }) {
    return this.money.repeatingChange(user, key, body.what);
  }

  /** Managers only: what an expense can be for (customers, deals, orders, factories). */
  @RequireFeature("expenses")
  @SignedIn("checked inside: expenses.manage")
  @Get("expenses/targets")
  expenseTargets(@CurrentUser() user: SessionUser) {
    return this.accounts.expenseTargets(user);
  }

  /** Managers only: Reports › Spending for a period (?from&to, and the period before ?prevFrom&prevTo to compare). */
  @RequireFeature("expenses")
  @SignedIn("checked inside: expenses.manage")
  @Get("reports/spending")
  spendingReport(
    @CurrentUser() user: SessionUser,
    @Query(Validate(z.object({ from: date, to: date, prevFrom: date, prevTo: date }))) q: { from?: string; to?: string; prevFrom?: string; prevTo?: string },
  ) {
    return this.accounts.spendingReport(user, q);
  }

  /** Managers only: what one person spent (paid, or recorded with nobody named), by kind and by what for, and what is owed back to them. */
  @RequireFeature("expenses")
  @SignedIn("checked inside: expenses.manage")
  @Get("people/:id/spending")
  personSpending(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Query(Validate(z.object({ from: date, to: date }))) q: { from?: string; to?: string }) {
    return this.accounts.personSpending(user, id, q);
  }

  /** Managers only: a customer's deals, what they earned us, everything spent on them, and a timeline. */
  @RequireFeature("expenses")
  @SignedIn("checked inside: expenses.manage")
  @Get("customers/:id/account")
  customerAccount(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.accounts.customerAccount(user, id);
  }

  /** An order's money: payment plan, what we owe and paid factories, expenses and profit (each for the people who may see it). */
  @SignedIn("checked inside: documents.manage, expenses.manage, orders.update, payments.record, sourcing.manage")
  @Get("orders/:id/money")
  forOrder(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.money.forOrder(user, id);
  }

  /** An order's costs: planned on the quote against spent, its expenses by step, the profit now expected, who to repay (managers). */
  @RequireFeature("expenses")
  @RequirePermissions("expenses.manage")
  @Get("orders/:id/costs")
  costsOf(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.costs.forOrder(user, id);
  }

  /* The order's payments to its suppliers: Treasury records them; the answer is the order's money view. */

  @SignedIn("checked inside: documents.manage, expenses.manage, orders.update, payments.record, sourcing.manage")
  @Post("orders/:id/factory-payments")
  @Once()
  async payFactory(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(factoryPaymentInput)) body: FactoryPaymentInput) {
    const { createdId } = await this.supplierPayments.recordFactoryPayment(user, id, body);
    return { ...(await this.money.forOrder(user, id)), createdId };
  }

  /** Same body as recording, plus reason (always asked). */
  @SignedIn("checked inside: documents.manage, expenses.manage, orders.update, payments.record, sourcing.manage")
  @Patch("factory-payments/:id")
  async editFactoryPayment(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(factoryPaymentInput)) body: FactoryPaymentInput) {
    const { orderId } = await this.supplierPayments.editFactoryPayment(user, id, body);
    return this.money.forOrder(user, orderId);
  }

  @SignedIn("checked inside: documents.manage, expenses.manage, orders.update, payments.record, sourcing.manage")
  @Post("factory-payments/:id/void")
  @HttpCode(200)
  async voidFactoryPayment(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(voidInput)) body: z.infer<typeof voidInput>) {
    const { orderId } = await this.supplierPayments.voidFactoryPayment(user, id, body.reason);
    return this.money.forOrder(user, orderId);
  }

  /** { items: [{ id?, label, amount, dueOn? }], reason? } — they must add up to the order total. */
  @SignedIn("checked inside: documents.manage, expenses.manage, orders.update, payments.record, sourcing.manage")
  @Put("orders/:id/payment-plan")
  async plan(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(paymentPlanInput)) body: PaymentPlanInput) {
    await this.billing.setPlan(user, id, body);
    return this.money.forOrder(user, id);
  }

  /** { factoryId, items: [{ label, percent?, amount, dueRule: on_order | on_ready | fixed, dueOn? }] } — they add up to what we owe it. */
  @Put("orders/:id/factory-plan")
  @RequirePermissions("sourcing.manage")
  async factoryPlan(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(factoryPlanInput)) body: FactoryPlanInput) {
    await this.billing.setFactoryPlan(user, id, body);
    return this.money.forOrder(user, id);
  }

  /** Managers only. ?from&to (dates), ?orderId, ?customerId, ?category, ?kind=order|customer|general; with totals by kind and by customer. */
  @RequireFeature("expenses")
  @SignedIn("checked inside: expenses.manage")
  @Get("expenses")
  expenses(@CurrentUser() user: SessionUser, @Query(Validate(expenseQuery)) q: z.infer<typeof expenseQuery>) {
    return this.money.listExpenses(user, q);
  }

  @RequireFeature("expenses")
  @SignedIn("checked inside: expenses.manage")
  @Post("expenses")
  @Once()
  createExpense(@CurrentUser() user: SessionUser, @Body(Validate(expenseInput)) body: ExpenseInput) {
    return this.money.createExpense(user, body);
  }

  /** Same body as adding, plus reason (always asked). */
  @RequireFeature("expenses")
  @SignedIn("checked inside: expenses.manage")
  @Patch("expenses/:id")
  editExpense(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(expenseInput)) body: ExpenseInput) {
    return this.money.editExpense(user, id, body);
  }

  @RequireFeature("expenses")
  @SignedIn("checked inside: expenses.manage")
  @Post("expenses/:id/void")
  @HttpCode(200)
  voidExpense(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(voidInput)) body: z.infer<typeof voidInput>,
  ) {
    return this.money.voidExpense(user, id, body.reason);
  }

  /** { repaidOn, accountId? }: paying back someone who paid it from their own money. */
  @RequireFeature("expenses")
  @RequirePermissions("expenses.manage")
  @Post("expenses/:id/repay")
  @Once()
  @HttpCode(200)
  repayExpense(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(repayInput)) body: RepayInput) {
    return this.money.repayExpense(user, id, body);
  }

  /** multipart/form-data with one `file`: a photo or PDF of the receipt (replaces the one there). */
  @RequireFeature("expenses")
  @SignedIn("checked inside: expenses.manage")
  @Post("expenses/:id/receipt")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD, files: 1 } }))
  attachReceipt(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new z.ZodError([{ code: "custom", path: ["file"], message: "Choose a photo or PDF of the receipt", input: undefined }]);
    return this.money.attachReceipt(user, id, file);
  }

  @RequireFeature("expenses")
  @SignedIn("checked inside: expenses.manage")
  @Delete("expenses/:id/receipt")
  removeReceipt(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.money.removeReceipt(user, id);
  }

  /** Managers only: the year month by month, earned and cash, in the main currency. */
  @RequireFeature("insights")
  @SignedIn("checked inside: expenses.manage")
  @Get("money/profit-and-loss")
  pnl(@CurrentUser() user: SessionUser, @Query(Validate(yearQuery)) q: z.infer<typeof yearQuery>) {
    return this.money.profitAndLoss(user, q.year);
  }
}
