import { Injectable } from "@nestjs/common";
import type { MailOutForm } from "@kebo/shared";
import { DomainError } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { CompanyMail } from "../../common/notify/company-mail";
import type { SessionUser } from "../../common/auth/session-user";
import { OrderFilesService } from "./order-files.service";

type Upload = { originalname: string; mimetype: string; size: number; buffer: Buffer };

/** Most email services take 25 MB a message; base64 makes files a third bigger. */
export const MAX_EMAIL_BYTES = 18 * 1024 * 1024;

/**
 * Email from the app (design "Email and Share", 26 Nov 2026): any document or file, from the company's one
 * address (Admin settings › Email sending), with what goes attached (made and fetched by the web app with the
 * person's own access). An order's email is checked first and noted in its History; anything else in the
 * activity log of what it is about.
 */
@Injectable()
export class MailOutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: CompanyMail,
    private readonly orderFiles: OrderFilesService,
  ) {}

  async send(user: SessionUser, input: MailOutForm, files: Upload[]) {
    if (!files.length) throw new DomainError("Nothing is attached: choose what goes.");
    if (input.names.length && input.names.length !== files.length) throw new DomainError("The files' names do not match the files. Try again.");
    if (files.reduce((t, f) => t + f.size, 0) > MAX_EMAIL_BYTES)
      throw new DomainError("These files are over 18 MB together: too big for one email. Send fewer at once, or use Share.");
    // An order's: what is said to go is on it, checked before anything leaves.
    const order = input.order ? await this.orderFiles.emailing(user, input.order, input.papers, input.files) : null;
    const mailer = await this.mail.mailer();
    if (!mailer.enabled)
      throw new DomainError("The company's email is not set up yet (an admin sets it under Admin settings › Email sending). Choose “I'll send it myself”.");
    const names = files.map((f, i) => input.names[i] || f.originalname);
    await mailer.send({
      to: input.to,
      cc: input.cc.length ? input.cc : undefined,
      subject: input.subject,
      text: input.message?.trim() || input.subject,
      replyTo: user.email ?? undefined,
      attachments: files.map((f, i) => ({ filename: names[i]!, content: f.buffer, contentType: f.mimetype || "application/octet-stream" })),
    });
    if (order) await order.done({ to: input.to, cc: input.cc, message: input.message });
    else {
      const [entityType, entityId] = input.about ? input.about.split(":") : ["mail", null];
      const what = names.length === 1 ? names[0] : `${names.length} files (${names.slice(0, 3).join(", ")}${names.length > 3 ? " …" : ""})`;
      await this.audit.record(this.prisma.db, {
        userId: user.id,
        action: "email",
        entityType: entityType!,
        entityId,
        summary: `emailed ${what} to ${input.to.join(", ")} from the app`,
        newValues: { to: input.to, ...(input.cc.length ? { cc: input.cc } : {}), files: names, ...(input.message ? { message: input.message } : {}) },
      });
    }
    return { ok: true, to: input.to };
  }
}
