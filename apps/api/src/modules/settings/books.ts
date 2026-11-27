import { Body, Controller, Get, Injectable, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { DomainError, monthEnd, monthStart, type ISODate } from "@kebo/utils";
import { fromDbDate, toDbDate } from "@kebo/database";
import { CurrentUser, RequirePermissions, SignedIn } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { Validate } from "../../common/http/zod.pipe";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import { PrismaService } from "../../database/prisma.service";

export interface BooksView {
  /** Money dated on or before this day is kept as reported (null: no month is closed). */
  closedThrough: ISODate | null;
  closedBy: string | null;
  closedAt: string | null;
  reason: string | null;
  /** The last month that may be closed now: the one before this month. */
  latest: ISODate;
}

const closeInput = z.object({
  /** "2026-10": close through the end of that month; null: reopen every month. */
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month")
    .nullable(),
  reason: z.string().trim().max(500).optional(),
});

/**
 * The month close (Settings › Closed months): money dated on or before `closedThrough` stays as it was reported. The
 * database refuses a payment, cost, transfer or allocation dated then (migration month_close); here the date
 * is moved: on to a month that has ended, or back (reopening) with a reason. Every move is in the audit log.
 */
@Injectable()
export class BooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async view(): Promise<BooksView> {
    const b = await this.prisma.db.booksClose.findFirst({ include: { closedBy: { select: { name: true } } } });
    const today = this.clock.today();
    return {
      closedThrough: b ? (fromDbDate(b.closedThrough) as ISODate) : null,
      closedBy: b?.closedBy?.name ?? null,
      closedAt: b ? b.closedAt.toISOString() : null,
      reason: b?.reason ?? null,
      latest: monthEnd(monthStart(today, -1)),
    };
  }

  async close(user: SessionUser, input: z.infer<typeof closeInput>): Promise<BooksView> {
    const before = await this.view();
    const through = input.month ? monthEnd(input.month) : null;
    if (through && through > before.latest) throw new DomainError("Only a month that has ended can be closed.");
    const back = before.closedThrough !== null && (through === null || through < before.closedThrough);
    if (back && !input.reason) throw new DomainError("Say why the month is opened again: its figures may change.");
    if (through === before.closedThrough) return before;
    await this.prisma.tx(async (tx) => {
      if (through) {
        const data = { closedThrough: toDbDate(through), closedById: user.id, closedAt: new Date(), reason: input.reason || null };
        await tx.booksClose.upsert({ where: { companyId: user.companyId }, create: data, update: data });
      } else await tx.booksClose.deleteMany({});
      await this.audit.record(tx, {
        userId: user.id,
        action: back ? "books_reopened" : "books_closed",
        entityType: "settings",
        summary: through ? `${back ? "Reopened the books after" : "Closed the books through"} ${through}` : "Reopened every month",
        oldValues: { closedThrough: before.closedThrough } as never,
        newValues: { closedThrough: through } as never,
        reason: input.reason || null,
      });
    });
    return this.view();
  }
}

@ApiTags("settings")
@Controller("books")
export class BooksController {
  constructor(private readonly books: BooksService) {}

  /** Whether months are closed, and through when (forms say why a back-dated save is refused). */
  @SignedIn("anyone signed in to the company")
  @Get("close")
  view() {
    return this.books.view();
  }

  /** { month: "2026-10" | null, reason? }: close through that month's end, or open months again (with a reason). */
  @Put("close")
  @RequirePermissions("settings.manage")
  close(@CurrentUser() user: SessionUser, @Body(Validate(closeInput)) body: z.infer<typeof closeInput>) {
    return this.books.close(user, body);
  }
}
