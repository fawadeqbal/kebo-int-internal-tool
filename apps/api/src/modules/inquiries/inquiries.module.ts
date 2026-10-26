import { Module } from "@nestjs/common";
import { FilesController, InquiriesController, WebsiteController } from "./inquiries.controller";
import { InquiriesService } from "./inquiries.service";
import { StagesService } from "./stages.service";
import { WebsiteService } from "./website.service";

@Module({
  controllers: [InquiriesController, FilesController, WebsiteController],
  providers: [InquiriesService, StagesService, WebsiteService],
  exports: [InquiriesService, StagesService],
})
export class InquiriesModule {}
