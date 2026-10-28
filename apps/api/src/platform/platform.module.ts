import { Module } from "@nestjs/common";
import { AccountsService } from "./accounts.service";
import { PlatformCompaniesService } from "./companies.platform";
import { CompanyDataService } from "./company-data";
import { LeadsService } from "./leads.service";
import { LifecycleService } from "./lifecycle.service";
import { PlansService } from "./plans.service";
import { PlatformAuthService, PlatformGuard } from "./platform-auth";
import { PlatformAuthController, PlatformController, PlatformPublicController } from "./platform.controller";
import { PlatformMail } from "./platform-mail";
import { SiteService } from "./site.service";

/** The platform: companies, plans, client inquiries, demos and trials, and the platform admins. */
@Module({
  controllers: [PlatformAuthController, PlatformPublicController, PlatformController],
  providers: [
    PlatformAuthService,
    PlatformGuard,
    AccountsService,
    PlatformCompaniesService,
    CompanyDataService,
    LeadsService,
    LifecycleService,
    PlansService,
    PlatformMail,
    SiteService,
  ],
  exports: [PlatformAuthService, AccountsService, LifecycleService],
})
export class PlatformModule {}
