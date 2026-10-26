import { Global, Module } from "@nestjs/common";
import { AuditService } from "./audit/audit.service";
import { Clock } from "./time/clock.service";

@Global()
@Module({ providers: [AuditService, Clock], exports: [AuditService, Clock] })
export class CommonModule {}
