import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { Injectable } from "@nestjs/common";
import { can } from "@kebo/shared";
import { DomainError, ForbiddenError, NotFoundError } from "@kebo/utils";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { safeFileName, StorageService } from "../../common/storage/storage.service";
import { AuditService } from "../../common/audit/audit.service";
import type { SessionUser } from "../../common/auth/session-user";
import { OrdersService } from "../orders/orders.service";

/** Money in from a customer, or out to a factory. */
export type PaymentSide = "in" | "out";

const EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png", "webp", "gif", "heic"]);

type Row = {
  id: string;
  orderId: string;
  fileKey: string | null;
  fileName: string | null;
  fileType: string | null;
  fileSize: number | null;
  voidedAt: Date | null;
};

/**
 * A photo or PDF kept with a payment as proof: the bank slip, a transfer
 * screenshot, the factory's receipt. One per payment; a new one replaces it.
 * Those who record payments add and remove it; whoever can see the payment
 * can open it (factory payments: those who see costs).
 */
@Injectable()
export class PaymentFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly orders: OrdersService,
  ) {}

  private async find(side: PaymentSide, id: string): Promise<Row> {
    const row =
      side === "in"
        ? await this.prisma.db.payment.findUnique({ where: { id } })
        : await this.prisma.db.factoryPayment.findUnique({ where: { id } });
    if (!row) throw new NotFoundError("Payment");
    return row;
  }

  /** Can this person see the payment? (Throws as if it were not there.) */
  private async canSee(user: SessionUser, side: PaymentSide, row: Row) {
    if (side === "out" && !can(user, "sourcing.manage")) throw new NotFoundError("Payment");
    await this.orders.load(user, row.orderId);
  }

  private async canChange(user: SessionUser, side: PaymentSide, id: string) {
    if (!can(user, "payments.record")) throw new ForbiddenError("Only accounts (managers) can change payments.");
    const row = await this.find(side, id);
    await this.canSee(user, side, row);
    if (row.voidedAt) throw new DomainError("This payment was removed.");
    return row;
  }

  private update(
    side: PaymentSide,
    id: string,
    data: { fileKey: string | null; fileName: string | null; fileType: string | null; fileSize: number | null },
    tx: Tx,
  ) {
    return side === "in" ? tx.payment.update({ where: { id }, data }) : tx.factoryPayment.update({ where: { id }, data });
  }

  async attach(
    user: SessionUser,
    side: PaymentSide,
    id: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ) {
    const row = await this.canChange(user, side, id);
    const ext = file.originalname.split(".").pop()?.toLowerCase() ?? "";
    if (!EXTENSIONS.has(ext)) throw new DomainError("Proof of payment can be a photo (JPG, PNG, WEBP) or a PDF.");
    if (file.size > this.storage.maxBytes)
      throw new DomainError(`Files can be up to ${Math.round(this.storage.maxBytes / 1024 / 1024)} MB.`);
    const name = safeFileName(file.originalname);
    const key = this.storage.keyFor(`payments/${side}/${id}/${randomUUID()}-${name}`);
    await this.storage.put(key, file.buffer, file.mimetype);
    try {
      const o = await this.orders.load(user, row.orderId);
      await this.prisma.tx(async (tx) => {
        await this.update(
          side,
          id,
          { fileKey: key, fileName: name, fileType: file.mimetype || "application/octet-stream", fileSize: file.size },
          tx,
        );
        await this.audit.record(tx, {
          userId: user.id,
          action: "payment_file",
          entityType: "order",
          entityId: row.orderId,
          summary: `${o.refNo}: ${row.fileKey ? "replaced" : "added"} the proof of a payment ${side === "in" ? "from the customer" : "to a factory"} (${name})`,
        });
      });
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
    if (row.fileKey) await this.storage.delete(row.fileKey).catch(() => undefined);
    return { id, file: { name, type: file.mimetype, size: file.size } };
  }

  async open(
    user: SessionUser,
    side: PaymentSide,
    id: string,
  ): Promise<{ stream: Readable; fileName: string; mimeType: string; size: number }> {
    const row = await this.find(side, id);
    await this.canSee(user, side, row);
    if (!row.fileKey) throw new NotFoundError("File");
    return {
      stream: await this.storage.get(row.fileKey),
      fileName: row.fileName ?? "payment",
      mimeType: row.fileType ?? "application/octet-stream",
      size: row.fileSize ?? 0,
    };
  }

  async remove(user: SessionUser, side: PaymentSide, id: string) {
    const row = await this.canChange(user, side, id);
    if (!row.fileKey) return { ok: true };
    const o = await this.orders.load(user, row.orderId);
    await this.prisma.tx(async (tx) => {
      await this.update(side, id, { fileKey: null, fileName: null, fileType: null, fileSize: null }, tx);
      await this.audit.record(tx, {
        userId: user.id,
        action: "payment_file",
        entityType: "order",
        entityId: row.orderId,
        summary: `${o.refNo}: removed the proof of a payment ${side === "in" ? "from the customer" : "to a factory"} (${row.fileName})`,
      });
    });
    await this.storage.delete(row.fileKey).catch(() => undefined);
    return { ok: true };
  }
}
