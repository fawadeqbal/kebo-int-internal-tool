import { Module } from "@nestjs/common";
import { StorageModule } from "../common/storage/storage.service";
import { CompanyDataService } from "./company-data";
import { LifecycleService } from "./lifecycle.service";
import { PlatformMail } from "./platform-mail";
import { ServerHealthService } from "./server-health";

/** What the background worker needs of the platform: the automatic rules for companies, the server check. */
@Module({
  imports: [StorageModule],
  providers: [CompanyDataService, LifecycleService, PlatformMail, ServerHealthService],
  exports: [LifecycleService, ServerHealthService],
})
export class PlatformJobsModule {}
