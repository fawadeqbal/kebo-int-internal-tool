import { Module } from "@nestjs/common";
import { AccountsService } from "./accounts.service";
import { PlatformCompaniesService } from "./companies.platform";
import { CompanyDataService } from "./company-data";
import { DevToolsController, DevToolsService } from "./dev-tools";
import { LeadsService } from "./leads.service";
import { LifecycleService } from "./lifecycle.service";
import { PlansService } from "./plans.service";
import { PlatformAuthService, PlatformGuard } from "./platform-auth";
import { PlatformAuthController, PlatformController, PlatformPublicController } from "./platform.controller";
import { PlatformMail } from "./platform-mail";
import { SiteService } from "./site.service";
import { AppErrors, RequestStats } from "./watch";

/** The platform: companies, plans, client inquiries, demos and trials, and the platform admins. */
@Module({
  controllers: [PlatformAuthController, PlatformPublicController, PlatformController, DevToolsController],
  providers: [
    PlatformAuthService,
    PlatformGuard,
    AccountsService,
    PlatformCompaniesService,
    CompanyDataService,
    DevToolsService,
    LeadsService,
    LifecycleService,
    PlansService,
    PlatformMail,
    SiteService,
    RequestStats,
    AppErrors,
  ],
  exports: [PlatformAuthService, AccountsService, LifecycleService, RequestStats, AppErrors],
})
export class PlatformModule {}
