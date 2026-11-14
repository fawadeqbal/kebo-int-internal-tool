import { Global, Module } from "@nestjs/common";
import { AuditService } from "./audit/audit.service";
import { Clock } from "./time/clock.service";
import { ReadCache } from "./cache/read-cache";
import { CompanyMail } from "./notify/company-mail";

@Global()
@Module({ providers: [AuditService, Clock, ReadCache, CompanyMail], exports: [AuditService, Clock, ReadCache, CompanyMail] })
export class CommonModule {}
