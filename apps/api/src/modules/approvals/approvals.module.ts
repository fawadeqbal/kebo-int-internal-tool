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
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, RequirePermissions } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { OrdersModule } from "../orders/orders.module";
import { MoneyModule } from "../money/money.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ApprovalsService, SUBMISSION_KINDS, SUBMISSION_STATUSES } from "./approvals.service";

const MAX_UPLOAD = 200 * 1024 * 1024; // hard ceiling; the configured limit is checked in the service
const body = z.record(z.string(), z.unknown(), "Send the details (body)");
const submitInput = z.object({ kind: z.enum(SUBMISSION_KINDS, "Say what it is: payment or expense"), orderId: z.uuid().nullish(), body });
const editInput = z.object({ orderId: z.uuid().nullish(), body });
const approveInput = z.object({ body: body.optional() });
const sendBackInput = z.object({
  reason: z.string().trim().min(1, "Say why it is sent back").max(500, "Keep the reason under 500 characters"),
});
const listQuery = z.object({
  status: z.enum([...SUBMISSION_STATUSES, "all"]).default("pending"),
  mine: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Money received and expenses sent for a manager to approve. Who sends: money.submit. Who approves:
 * payments.record (money received) and expenses.manage with the expenses feature (expenses).
 */
@ApiTags("approvals")
@Controller("submissions")
class SubmissionsController {
  constructor(private readonly approvals: ApprovalsService) {}

  /** ?status=pending|approved|sent_back|withdrawn|all&mine=true&page&pageSize → { rows, total, page, pageSize, counts, approves, canSubmit } */
  @Get()
  list(@CurrentUser() user: SessionUser, @Query(Validate(listQuery)) q: z.infer<typeof listQuery>) {
    return this.approvals.list(user, q);
  }

  /** { kind: payment | expense, orderId? (needed for payment), body } — body as POST /orders/:id/payments or POST /expenses takes it. */
  @Post()
  @RequirePermissions("money.submit")
  submit(@CurrentUser() user: SessionUser, @Body(Validate(submitInput)) input: z.infer<typeof submitInput>) {
    return this.approvals.submit(user, input);
  }

  @Get(":id")
  get(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.approvals.get(user, id);
  }

  /** { orderId?, body } — the submitter changes one waiting or sent back; it waits again. */
  @Patch(":id")
  edit(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(editInput)) input: z.infer<typeof editInput>,
  ) {
    return this.approvals.edit(user, id, input);
  }

  /** { body? } (a corrected body, checked the same way) — records it as the approver → { submission, createdId }. */
  @Post(":id/approve")
  @HttpCode(200)
  approve(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(approveInput)) input: z.infer<typeof approveInput>,
  ) {
    return this.approvals.approve(user, id, input);
  }

  /** { reason } */
  @Post(":id/send-back")
  @HttpCode(200)
  sendBack(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(sendBackInput)) input: z.infer<typeof sendBackInput>,
  ) {
    return this.approvals.sendBack(user, id, input.reason);
  }

  @Post(":id/withdraw")
  @HttpCode(200)
  withdraw(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.approvals.withdraw(user, id);
  }

  /** multipart/form-data with one `file`: the bank slip or receipt, a photo or PDF (replaces the one there). */
  @Post(":id/file")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD, files: 1 } }))
  attach(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file)
      throw new z.ZodError([
        { code: "custom", path: ["file"], message: "Choose a photo or PDF of the bank slip or receipt", input: undefined },
      ]);
    return this.approvals.attach(user, id, file);
  }

  @Get(":id/file")
  async file(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const f = await this.approvals.open(user, id);
    res.set({
      "Content-Type": f.mimeType,
      "Content-Length": String(f.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    });
    return new StreamableFile(f.stream);
  }

  @Delete(":id/file")
  removeFile(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.approvals.removeFile(user, id);
  }
}

@Module({ imports: [OrdersModule, MoneyModule, NotificationsModule], controllers: [SubmissionsController], providers: [ApprovalsService] })
export class ApprovalsModule {}
