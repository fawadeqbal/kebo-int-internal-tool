import { Controller, Get, Param, ParseEnumPipe, ParseUUIDPipe, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PAYMENT_DIRECTIONS, PAYMENT_RECORD_KINDS, type PaymentRecordKind } from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { TreasuryService } from "./treasury.service";

const day = z.iso.date();
const paymentsQuery = z.object({
  from: day.optional(),
  to: day.optional(),
  dir: z.enum(PAYMENT_DIRECTIONS).optional(),
  status: z.enum(["to_verify", "void"]).optional(),
  q: z.string().trim().max(100).optional(),
  order: z.uuid().optional(),
  party: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

const kindPipe = new ParseEnumPipe(
  Object.fromEntries(PAYMENT_RECORD_KINDS.map((k) => [k, k])) as Record<PaymentRecordKind, PaymentRecordKind>,
);

/** Treasury › Payments (read only): every payment in and out, and one payment's page. */
@ApiTags("treasury")
@Controller("treasury/payments")
class TreasuryController {
  constructor(private readonly payments: TreasuryService) {}

  /** ?from&to&dir&status&q&order&party&page&pageSize → { rows, total, page, pageSize, counts, canRecord } */
  @Get()
  list(@CurrentUser() user: SessionUser, @Query(Validate(paymentsQuery)) q: z.infer<typeof paymentsQuery>) {
    return this.payments.list(user, q);
  }

  /** Whether this person opens Treasury › Payments (the sidebar asks). */
  @Get("access")
  async access(@CurrentUser() user: SessionUser) {
    return { opens: await this.payments.opens(user) };
  }

  @Get(":kind/:id")
  one(@CurrentUser() user: SessionUser, @Param("kind", kindPipe) kind: PaymentRecordKind, @Param("id", ParseUUIDPipe) id: string) {
    return this.payments.one(user, kind, id);
  }
}

// Exported here, not on the class: the lint rule no-useless-assignment misreads a decorated exported class.
export { TreasuryController };
