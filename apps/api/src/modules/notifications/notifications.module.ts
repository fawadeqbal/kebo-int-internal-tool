import { Module } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { RemindersService } from "./reminders.service";
import { NotificationsController } from "./notifications.controller";

@Module({ controllers: [NotificationsController], providers: [NotificationsService, RemindersService], exports: [NotificationsService, RemindersService] })
export class NotificationsModule {}
