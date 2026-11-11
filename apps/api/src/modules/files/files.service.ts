import type { Readable } from "node:stream";
import { Injectable } from "@nestjs/common";
import { ForbiddenError, NotFoundError } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { StorageService } from "../../common/storage/storage.service";
import type { SessionUser } from "../../common/auth/session-user";
import { InquiriesService } from "../inquiries/inquiries.service";
import { PaymentFilesService } from "../treasury/payment-files.service";
import { MoneyService } from "../money/money.service";
import { ApprovalsService } from "../approvals/approvals.service";

export type OpenFile = { stream: Readable; fileName: string; mimeType: string; size: number };

/**
 * Every stored file is one attachment row, opened by its id at one address.
 * What it is kept on decides who may open it, and that record's module says:
 * a deal's file, those who see the deal; a payment entry's proof, those who see
 * the payment; an expense's receipt, those who see expenses; a submission's
 * photo, its submitter and approvers. Anyone else is told it is not there.
 */
@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly inquiries: InquiriesService,
    private readonly payments: PaymentFilesService,
    private readonly money: MoneyService,
    private readonly approvals: ApprovalsService,
  ) {}

  async open(user: SessionUser, id: string): Promise<OpenFile> {
    const a = await this.prisma.db.attachment.findFirst({ where: { id, deletedAt: null } });
    if (!a) throw new NotFoundError("File");
    try {
      if (a.inquiryId) await this.inquiries.mayOpenFile(user, a.id);
      else if (a.movementId) await this.payments.mayOpen(user, a.movementId);
      else if (a.expenseId) this.money.mayOpenReceipt(user);
      else if (a.submissionId) await this.approvals.mayOpen(user, a.submissionId);
      else throw new NotFoundError("File");
    } catch (error) {
      // Not allowed to see the record: the file is not there, whatever the record said.
      if (error instanceof NotFoundError || error instanceof ForbiddenError) throw new NotFoundError("File");
      throw error;
    }
    return { stream: await this.storage.get(a.storageKey), fileName: a.fileName, mimeType: a.mimeType, size: a.size };
  }
}
