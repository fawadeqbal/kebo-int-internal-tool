import { Global, Module } from "@nestjs/common";
import { AuditService } from "./audit/audit.service";
import { Clock } from "./time/clock.service";
import { ReadCache } from "./cache/read-cache";

@Global()
@Module({ providers: [AuditService, Clock, ReadCache], exports: [AuditService, Clock, ReadCache] })
export class CommonModule {}
