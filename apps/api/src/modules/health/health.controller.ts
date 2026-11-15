import { Controller, Get, Query, ServiceUnavailableException } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "../../common/auth/decorators";
import { PrismaService } from "../../database/prisma.service";
import { workerSilence } from "../../platform/server-health";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * For Docker and the load balancer: the API is up and can reach the database. For the outside watcher
   * (?from=outside, every 5 minutes from GitHub: .github/workflows/watch.yml) also that the background worker
   * still runs its jobs: a stopped worker cannot warn about itself.
   */
  @Public()
  @Get()
  async check(@Query("from") from?: string) {
    await this.prisma.db.$queryRaw`select 1`;
    if (from === "outside") {
      const [r] = await this.prisma.platform.$queryRaw<{ last: Date | null }[]>`
        select max(started_at + took_ms * interval '1 millisecond') as last from job_runs`;
      const silent = workerSilence(r?.last ?? null, new Date());
      if (silent) throw new ServiceUnavailableException({ message: silent, code: "worker_silent" });
    }
    return { ok: true, time: new Date().toISOString() };
  }
}
