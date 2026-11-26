import { Body, Controller, HttpCode, Post, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { ApiTags } from "@nestjs/swagger";
import { mailOutForm, type MailOutForm } from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, SignedIn } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { MAX_EMAIL_BYTES, MailOutService } from "./mail-out.service";

/** Email from the app: one endpoint for every document and file (design "Email and Share", 26 Nov 2026). */
@ApiTags("mail")
@Controller("mail")
export class MailOutController {
  constructor(private readonly mail: MailOutService) {}

  /** Multipart: to, cc, subject, message, names (JSON), order + papers + files, or about; what goes as `files`. */
  @SignedIn("an order's email: checked inside, as its files are; anything else: what the web app could open")
  @Post("send")
  @HttpCode(200)
  @UseInterceptors(FilesInterceptor("files", 12, { limits: { fileSize: MAX_EMAIL_BYTES, files: 12 } }))
  send(@CurrentUser() user: SessionUser, @Body(Validate(mailOutForm)) body: MailOutForm, @UploadedFiles() files: Express.Multer.File[] | undefined) {
    return this.mail.send(user, body, files ?? []);
  }
}
