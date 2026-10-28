import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  CURRENCIES,
  EXPENSE_CATEGORIES,
  expenseInput,
  moneyAccountInput,
  transferInput,
  type MoneyAccountInput,
  type TransferInput,
  factoryPaymentInput,
  paymentPlanInput,
  voidInput,
  type ExpenseInput,
  type FactoryPaymentInput,
  type PaymentPlanInput,
} from "@kebo/shared";
import { isISODate } from "@kebo/utils";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, RequireFeature } from "../../common/auth/decorators";
import { LimitsService } from "../../common/company/limits.service";
import type { SessionUser } from "../../common/auth/session-user";
import { OrdersModule } from "../orders/orders.module";
import { MoneyService } from "./money.service";
import { AccountsService } from "./accounts.service";
import { CashService } from "./cash.service";
import { LeaksService } from "./leaks.service";
import { PaymentFilesService, type PaymentSide } from "./payment-files.service";

const date = z.string().refine(isISODate, "Use a valid date (YYYY-MM-DD)").optional();
const expenseQuery = z.object({
  from: date,
  to: date,
  orderId: z.uuid().optional(),
  inquiryId: z.uuid().optional(),
  factoryId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  kind: z.enum(["order", "customer", "general"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});
const MAX_UPLOAD = 200 * 1024 * 1024; // hard ceiling; the configured limit is checked in the service
const flag = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");
const cashBookQuery = z.object({
  from: z.string().refine(isISODate, "Use a valid date (YYYY-MM-DD)"),
  to: z.string().refine(isISODate, "Use a valid date (YYYY-MM-DD)"),
  account: z.union([z.uuid(), z.literal("none")]).optional(),
  currency: z.enum(CURRENCIES).optional(),
  removed: flag,
});
const yearQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100) });

@ApiTags("money")
@Controller()
class MoneyController {
  constructor(
    private readonly money: MoneyService,
    private readonly accounts: AccountsService,
    private readonly cash: CashService,
    private readonly leaks: LeaksService,
    private readonly paymentFiles: PaymentFilesService,
    private readonly limits: LimitsService,
  ) {}

  /** Managers: where we lose money in a period (?from&to, default this year), with warnings. */
  @RequireFeature("insights")
  @Get("reports/leaks")
  leaksReport(@CurrentUser() user: SessionUser, @Query(Validate(z.object({ from: date, to: date }))) q: { from?: string; to?: string }) {
    return this.leaks.report(user, q);
  }

  /** Our accounts (cash, banks, wallets): to choose from when recording money; managers also get balances. */
  @Get("money/accounts")
  async moneyAccounts(@CurrentUser() user: SessionUser) {
    // The cash book is a plan feature: without it there are no accounts to choose.
    return (await this.limits.allows("cash_book")) ? this.cash.accounts(user) : [];
  }

  @RequireFeature("cash_book")
  @Post("money/accounts")
  addAccount(@CurrentUser() user: SessionUser, @Body(Validate(moneyAccountInput)) body: MoneyAccountInput) {
    return this.cash.saveAccount(user, null, body);
  }

  @RequireFeature("cash_book")
  @Patch("money/accounts/:id")
  changeAccount(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(moneyAccountInput)) body: MoneyAccountInput) {
    return this.cash.saveAccount(user, id, body);
  }

  /** Money moved between two of our accounts. */
  @RequireFeature("cash_book")
  @Post("money/transfers")
  transfer(@CurrentUser() user: SessionUser, @Body(Validate(transferInput)) body: TransferInput) {
    return this.cash.transfer(user, body);
  }

  @RequireFeature("cash_book")
  @Post("money/transfers/:id/void")
  @HttpCode(200)
  voidTransfer(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(voidInput)) body: z.infer<typeof voidInput>) {
    return this.cash.voidTransfer(user, id, body.reason);
  }

  /** Managers: every amount in and out between two dates; ?account=<id>|none, ?currency=, ?removed=true. */
  @RequireFeature("cash_book")
  @Get("money/cash-book")
  cashBook(@CurrentUser() user: SessionUser, @Query(Validate(cashBookQuery)) q: z.infer<typeof cashBookQuery>) {
    return this.cash.cashBook(user, q);
  }

  /** Put a payment, a factory payment or an expense on an account afterwards: { accountId | null }. */
  @RequireFeature("cash_book")
  @Put("money/entries/:kind/:id/account")
  setAccount(
    @CurrentUser() user: SessionUser,
    @Param("kind") kind: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(z.object({ accountId: z.uuid().nullable() }))) body: { accountId: string | null },
  ) {
    const k = z.enum(["in", "factory", "expense"]).parse(kind);
    return this.cash.setAccount(user, k, id, body.accountId);
  }

  /** Managers only: what an expense can be for (customers, deals, orders, factories). */
  @RequireFeature("expenses")
  @Get("expenses/targets")
  expenseTargets(@CurrentUser() user: SessionUser) {
    return this.accounts.expenseTargets(user);
  }

  /** Managers only: a customer's deals, what they earned us, everything spent on them, and a timeline. */
  @RequireFeature("expenses")
  @Get("customers/:id/account")
  customerAccount(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.accounts.customerAccount(user, id);
  }

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

  /** Managers only. ?from&to (dates), ?orderId, ?customerId, ?category, ?kind=order|customer|general; with totals by kind and by customer. */
  @RequireFeature("expenses")
  @Get("expenses")
  expenses(@CurrentUser() user: SessionUser, @Query(Validate(expenseQuery)) q: z.infer<typeof expenseQuery>) {
    return this.money.listExpenses(user, q);
  }

  @RequireFeature("expenses")
  @Post("expenses")
  createExpense(@CurrentUser() user: SessionUser, @Body(Validate(expenseInput)) body: ExpenseInput) {
    return this.money.createExpense(user, body);
  }

  /** Same body as adding, plus reason (always asked). */
  @RequireFeature("expenses")
  @Patch("expenses/:id")
  editExpense(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(expenseInput)) body: ExpenseInput) {
    return this.money.editExpense(user, id, body);
  }

  @RequireFeature("expenses")
  @Post("expenses/:id/void")
  @HttpCode(200)
  voidExpense(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(voidInput)) body: z.infer<typeof voidInput>,
  ) {
    return this.money.voidExpense(user, id, body.reason);
  }

  /** multipart/form-data with one `file`: a photo or PDF of the receipt (replaces the one there). */
  @RequireFeature("expenses")
  @Post("expenses/:id/receipt")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD, files: 1 } }))
  attachReceipt(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new z.ZodError([{ code: "custom", path: ["file"], message: "Choose a photo or PDF of the receipt", input: undefined }]);
    return this.money.attachReceipt(user, id, file);
  }

  @RequireFeature("expenses")
  @Get("expenses/:id/receipt")
  async receipt(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const f = await this.money.receipt(user, id);
    res.set({
      "Content-Type": f.mimeType,
      "Content-Length": String(f.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    });
    return new StreamableFile(f.stream);
  }

  @RequireFeature("expenses")
  @Delete("expenses/:id/receipt")
  removeReceipt(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.money.removeReceipt(user, id);
  }

  /**
   * multipart/form-data with one `file`: a photo or PDF proving a payment (bank
   * slip, transfer screenshot). `payments` is money in from a customer,
   * `factory-payments` money out to a factory. A new one replaces the one there.
   */
  @Post("payments/:id/file")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD, files: 1 } }))
  attachPaymentFile(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.attachFile(user, "in", id, file);
  }

  @Post("factory-payments/:id/file")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD, files: 1 } }))
  attachFactoryPaymentFile(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.attachFile(user, "out", id, file);
  }

  @Get("payments/:id/file")
  paymentFile(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    return this.sendFile(user, "in", id, res);
  }

  @Get("factory-payments/:id/file")
  factoryPaymentFile(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    return this.sendFile(user, "out", id, res);
  }

  @Delete("payments/:id/file")
  removePaymentFile(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.paymentFiles.remove(user, "in", id);
  }

  @Delete("factory-payments/:id/file")
  removeFactoryPaymentFile(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.paymentFiles.remove(user, "out", id);
  }

  private attachFile(user: SessionUser, side: PaymentSide, id: string, file: Express.Multer.File | undefined) {
    if (!file) throw new z.ZodError([{ code: "custom", path: ["file"], message: "Choose a photo or PDF of the payment", input: undefined }]);
    return this.paymentFiles.attach(user, side, id, file);
  }

  private async sendFile(user: SessionUser, side: PaymentSide, id: string, res: Response) {
    const f = await this.paymentFiles.open(user, side, id);
    res.set({
      "Content-Type": f.mimeType,
      "Content-Length": String(f.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    });
    return new StreamableFile(f.stream);
  }

  /** Managers only: the year month by month, earned and cash, in the main currency. */
  @RequireFeature("insights")
  @Get("money/profit-and-loss")
  pnl(@CurrentUser() user: SessionUser, @Query(Validate(yearQuery)) q: z.infer<typeof yearQuery>) {
    return this.money.profitAndLoss(user, q.year);
  }
}

@Module({ imports: [OrdersModule], controllers: [MoneyController], providers: [MoneyService, AccountsService, CashService, LeaksService, PaymentFilesService], exports: [MoneyService, AccountsService, CashService, LeaksService] })
export class MoneyModule {}
