import { Module } from "@nestjs/common";
import { AccountsService } from "./accounts.service";
import { PlatformCompaniesService } from "./companies.platform";
import { CompanyDataService } from "./company-data";
import { DevToolsController, DevToolsService } from "./dev-tools";
import { DevToolsMoreService } from "./dev-tools-more";
import { LeadsService } from "./leads.service";
import { LifecycleService } from "./lifecycle.service";
import { PlansService } from "./plans.service";
import { PlatformAuthService, PlatformGuard } from "./platform-auth";
import { PlatformAuthController, PlatformController, PlatformPublicController } from "./platform.controller";
import { PlatformMail } from "./platform-mail";
import { SiteService } from "./site.service";
import { WatchModule } from "./watch";
import { TelemetryController } from "./telemetry.controller";

/** The platform: companies, plans, client inquiries, demos and trials, and the platform admins. */
@Module({
  imports: [WatchModule],
  controllers: [PlatformAuthController, PlatformPublicController, PlatformController, DevToolsController, TelemetryController],
  providers: [
    PlatformAuthService,
    PlatformGuard,
    AccountsService,
    PlatformCompaniesService,
    CompanyDataService,
    DevToolsService,
    DevToolsMoreService,
    LeadsService,
    LifecycleService,
    PlansService,
    PlatformMail,
    SiteService,
  ],
  exports: [PlatformAuthService, AccountsService, LifecycleService, WatchModule],
})
export class PlatformModule {}
