import { Module } from "@nestjs/common";
import { InquiriesController, WebsiteController } from "./inquiries.controller";
import { InquiriesService } from "./inquiries.service";
import { StagesService } from "./stages.service";
import { WebsiteService } from "./website.service";
import { NotesModule } from "../notes/notes.module";

@Module({
  imports: [NotesModule],
  controllers: [InquiriesController, WebsiteController],
  providers: [InquiriesService, StagesService, WebsiteService],
  exports: [InquiriesService, StagesService],
})
export class InquiriesModule {}
