import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { AuditService } from "./audit/audit.service";
import { Clock } from "./time/clock.service";
import { ReadCache } from "./cache/read-cache";
import { CompanyMail } from "./notify/company-mail";
import { OnceInterceptor } from "./http/once";

@Global()
@Module({
  providers: [AuditService, Clock, ReadCache, CompanyMail, { provide: APP_INTERCEPTOR, useClass: OnceInterceptor }],
  exports: [AuditService, Clock, ReadCache, CompanyMail],
})
export class CommonModule {}
