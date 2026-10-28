import { Module } from "@nestjs/common";
import { StorageModule } from "../common/storage/storage.service";
import { CompanyDataService } from "./company-data";
import { LifecycleService } from "./lifecycle.service";
import { PlatformMail } from "./platform-mail";

/** What the background worker needs of the platform: the automatic rules for companies. */
@Module({
  imports: [StorageModule],
  providers: [CompanyDataService, LifecycleService, PlatformMail],
  exports: [LifecycleService],
})
export class PlatformJobsModule {}
