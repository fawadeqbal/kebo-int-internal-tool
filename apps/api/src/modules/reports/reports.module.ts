import { Controller, Get, Module, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { optionalDate } from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, RequirePermissions, RequireFeature } from "../../common/auth/decorators";
import { Clock } from "../../common/time/clock.service";
import type { SessionUser } from "../../common/auth/session-user";
import { OrdersModule } from "../orders/orders.module";
import { ReportsService } from "./reports.service";

const rangeQuery = z.object({ from: optionalDate, to: optionalDate, staff: z.uuid().optional() });
const auditQuery = z.object({
  entityType: z.string().max(60).optional(),
  entityId: z.uuid().optional(),
  userId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

@ApiTags("reports")
@Controller()
class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly clock: Clock,
  ) {}

  /** The home screen: stage counts, my to-do, my deals, new deals, expiring quotes; money and workload for managers. */
  @Get("dashboard")
  @RequirePermissions("dashboard.view")
  dashboard(@CurrentUser() user: SessionUser) {
    return this.reports.dashboard(user);
  }

  /** ?from=YYYY-MM-DD&to=YYYY-MM-DD&staff=<id> (defaults: this month). */
  @Get("reports")
  @RequirePermissions("reports.view")
  report(@CurrentUser() user: SessionUser, @Query(Validate(rangeQuery)) q: z.infer<typeof rangeQuery>) {
    return this.reports.report(user, ReportsService.parseRange(q.from ?? undefined, q.to ?? undefined, this.clock.today()), q.staff);
  }

  @RequireFeature("audit_log")
  @Get("audit")
  @RequirePermissions("audit.view")
  audit(@CurrentUser() user: SessionUser, @Query(Validate(auditQuery)) q: z.infer<typeof auditQuery>) {
    return this.reports.audit(user, q);
  }
}

@Module({ imports: [OrdersModule], controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
