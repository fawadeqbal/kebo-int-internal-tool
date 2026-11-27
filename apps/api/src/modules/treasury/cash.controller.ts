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
  CURRENCIES,
  moneyAccountInput,
  transferInput,
  voidInput,
  type MoneyAccountInput,
  type TransferInput,
} from "@kebo/shared";
import { isISODate } from "@kebo/utils";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, RequireFeature, SignedIn } from "../../common/auth/decorators";
import { LimitsService } from "../../common/company/limits.service";
import type { SessionUser } from "../../common/auth/session-user";
import { CashService } from "./cash.service";
import { CashReportService } from "./cash-report.service";
import { PaymentFilesService, type PaymentSide } from "./payment-files.service";
import { SupplierPaymentsService } from "./supplier-payments.service";
import { Once } from "../../common/http/once";

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
  /** A page of the rows (the balances and totals are still of the whole period): { total, page, pageSize } too. */
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  /** Only the last n rows (an overview's latest moves). */
  latest: z.coerce.number().int().min(1).max(100).optional(),
});

const cashReportQuery = z.object({
  from: z.string().refine(isISODate, "Use a valid date (YYYY-MM-DD)"),
  to: z.string().refine(isISODate, "Use a valid date (YYYY-MM-DD)"),
});

/** Treasury: our accounts and the cash book, moves between accounts, supplier payments and every payment's proof. */
@ApiTags("treasury")
@Controller()
class CashController {
  constructor(
    private readonly cash: CashService,
    private readonly report: CashReportService,
    private readonly paymentFiles: PaymentFilesService,
    private readonly supplierPayments: SupplierPaymentsService,
    private readonly limits: LimitsService,
  ) {}

  /**
   * Our accounts (cash, banks, wallets): to choose from when recording money; managers also get balances.
   * ?choose=true: only the list to choose from (no balances), as every money window needs it.
   */
  @SignedIn("checked inside: expenses.manage, money.submit, payments.record")
  @Get("money/accounts")
  async moneyAccounts(@CurrentUser() user: SessionUser, @Query(Validate(z.object({ choose: z.enum(["true", "false"]).optional() }))) q: { choose?: string }) {
    // The cash book is a plan feature: without it there are no accounts to choose.
    return (await this.limits.allows("cash_book")) ? this.cash.accounts(user, q.choose === "true") : [];
  }

  @RequireFeature("cash_book")
  @SignedIn("checked inside: expenses.manage")
  @Post("money/accounts")
  addAccount(@CurrentUser() user: SessionUser, @Body(Validate(moneyAccountInput)) body: MoneyAccountInput) {
    return this.cash.saveAccount(user, null, body);
  }

  @RequireFeature("cash_book")
  @SignedIn("checked inside: expenses.manage")
  @Patch("money/accounts/:id")
  changeAccount(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(moneyAccountInput)) body: MoneyAccountInput) {
    return this.cash.saveAccount(user, id, body);
  }

  /** Money moved between two of our accounts. */
  @RequireFeature("cash_book")
  @SignedIn("checked inside: expenses.manage")
  @Post("money/transfers")
  @Once()
  transfer(@CurrentUser() user: SessionUser, @Body(Validate(transferInput)) body: TransferInput) {
    return this.cash.transfer(user, body);
  }

  @RequireFeature("cash_book")
  @SignedIn("checked inside: expenses.manage")
  @Post("money/transfers/:id/void")
  @HttpCode(200)
  voidTransfer(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(voidInput)) body: z.infer<typeof voidInput>) {
    return this.cash.voidTransfer(user, id, body.reason);
  }

  /** Managers: every amount in and out between two dates; ?account=<id>|none, ?currency=, ?removed=true. */
  @RequireFeature("cash_book")
  @SignedIn("checked inside: expenses.manage")
  @Get("money/cash-book")
  cashBook(@CurrentUser() user: SessionUser, @Query(Validate(cashBookQuery)) q: z.infer<typeof cashBookQuery>) {
    return this.cash.cashBook(user, q);
  }

  /** Managers: Reports › Cash. What came in and went out by month, and each account at the start and the end. */
  @RequireFeature("cash_book")
  @SignedIn("checked inside: expenses.manage")
  @Get("money/cash-report")
  cashReport(@CurrentUser() user: SessionUser, @Query(Validate(cashReportQuery)) q: z.infer<typeof cashReportQuery>) {
    return this.report.report(user, q);
  }

  /** Put a payment, a supplier payment or an expense on an account afterwards: { accountId | null }. */
  @RequireFeature("cash_book")
  @SignedIn("checked inside: expenses.manage")
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

  /**
   * multipart/form-data with one `file`: a photo or PDF proving a payment (bank
   * slip, transfer screenshot). `payments` is money in from a customer,
   * `factory-payments` money out to a supplier. A new one replaces the one there.
   */
  @SignedIn("checked inside: ledger.view, payments.record, sourcing.manage")
  @Post("payments/:id/file")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD, files: 1 } }))
  attachPaymentFile(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.attachFile(user, "in", id, file);
  }

  @SignedIn("checked inside: ledger.view, payments.record, sourcing.manage")
  @Post("supplier-payments/:id/file")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD, files: 1 } }))
  attachSupplierPaymentFile(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.attachFile(user, "out", id, file);
  }

  @SignedIn("checked inside: ledger.view, payments.record, sourcing.manage")
  @Delete("payments/:id/file")
  removePaymentFile(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.paymentFiles.remove(user, "in", id);
  }

  @SignedIn("checked inside: ledger.view, payments.record, sourcing.manage")
  @Delete("supplier-payments/:id/file")
  removeSupplierPaymentFile(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.paymentFiles.remove(user, "out", id);
  }

  private attachFile(user: SessionUser, side: PaymentSide, id: string, file: Express.Multer.File | undefined) {
    if (!file) throw new z.ZodError([{ code: "custom", path: ["file"], message: "Choose a photo or PDF of the payment", input: undefined }]);
    return this.paymentFiles.attach(user, side, id, file);
  }
}

export { CashController };
