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
  EXPENSE_CATEGORIES,
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
import { AccountsService } from "./accounts.service";

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
});
const MAX_UPLOAD = 200 * 1024 * 1024; // hard ceiling; the configured limit is checked in the service
const yearQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100) });
const flag = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");

@ApiTags("money")
@Controller()
class MoneyController {
  constructor(
    private readonly money: MoneyService,
    private readonly accounts: AccountsService,
  ) {}

  /** Managers only: what an expense can be for (customers, deals, orders, factories). */
  @Get("expenses/targets")
  expenseTargets(@CurrentUser() user: SessionUser) {
    return this.accounts.expenseTargets(user);
  }

  /** Managers only: a customer's deals, what they earned us, everything spent on them, and a timeline. */
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

  /** multipart/form-data with one `file`: a photo or PDF of the receipt (replaces the one there). */
  @Post("expenses/:id/receipt")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD, files: 1 } }))
  attachReceipt(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new z.ZodError([{ code: "custom", path: ["file"], message: "Choose a photo or PDF of the receipt", input: undefined }]);
    return this.money.attachReceipt(user, id, file);
  }

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

  @Delete("expenses/:id/receipt")
  removeReceipt(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.money.removeReceipt(user, id);
  }

  /** Managers only: the year month by month, earned and cash, in the main currency. */
  @Get("money/profit-and-loss")
  pnl(@CurrentUser() user: SessionUser, @Query(Validate(yearQuery)) q: z.infer<typeof yearQuery>) {
    return this.money.profitAndLoss(user, q.year);
  }
}

@Module({ imports: [OrdersModule], controllers: [MoneyController], providers: [MoneyService, AccountsService], exports: [MoneyService, AccountsService] })
export class MoneyModule {}
