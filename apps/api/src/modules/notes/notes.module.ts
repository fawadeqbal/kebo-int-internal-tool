import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { NotesService } from "./notes.service";
import { FollowUpsService } from "./follow-ups.service";
import { NotesController } from "./notes.controller";
import { FollowUpsController } from "./follow-ups.controller";

@Module({
  imports: [NotificationsModule],
  controllers: [NotesController, FollowUpsController],
  providers: [NotesService, FollowUpsService],
  exports: [NotesService, FollowUpsService],
})
export class NotesModule {}
