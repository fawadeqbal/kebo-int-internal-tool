import { Controller, Get, Module } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "../../common/auth/decorators";
import { PrismaService } from "../../database/prisma.service";

@ApiTags("health")
@Controller("health")
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** For Docker and the load balancer: the API is up and can reach the database. */
  @Public()
  @Get()
  async check() {
    await this.prisma.db.$queryRaw`select 1`;
    return { ok: true, time: new Date().toISOString() };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
