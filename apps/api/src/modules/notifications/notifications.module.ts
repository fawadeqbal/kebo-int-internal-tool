import { Body, Controller, Delete, Get, HttpCode, Module, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, RequirePermissions } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { NotificationsService } from "./notifications.service";
import { RemindersService } from "./reminders.service";

const readInput = z.object({ ids: z.union([z.literal("all"), z.array(z.uuid()).max(500)]) });
const deviceInput = z.object({ token: z.string().min(10).max(4096), platform: z.enum(["android", "ios", "web"]).default("android") });

@ApiTags("notifications")
@Controller()
class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly reminders: RemindersService,
  ) {}

  @Get("notifications")
  mine(@CurrentUser() user: SessionUser, @Query(Validate(z.object({ unread: z.enum(["true", "false"]).optional(), take: z.coerce.number().int().min(1).max(200).optional() }))) q: { unread?: string; take?: number }) {
    return this.notifications.mine(user, { unreadOnly: q.unread === "true", take: q.take });
  }

  /** { ids: [...] | "all" } */
  @Post("notifications/read")
  @HttpCode(200)
  read(@CurrentUser() user: SessionUser, @Body(Validate(readInput)) body: z.infer<typeof readInput>) {
    return this.notifications.markRead(user, body.ids);
  }

  @Post("me/devices")
  @HttpCode(200)
  device(@CurrentUser() user: SessionUser, @Body(Validate(deviceInput)) body: z.infer<typeof deviceInput>) {
    return this.notifications.registerDevice(user, body.token, body.platform);
  }

  @Delete("me/devices")
  @HttpCode(200)
  forget(@CurrentUser() user: SessionUser, @Body(Validate(deviceInput.pick({ token: true }))) body: { token: string }) {
    return this.notifications.removeDevice(user, body.token);
  }

  /** Run the reminder job now (admins; the worker runs it on a schedule). */
  @Post("admin/reminders/run")
  @HttpCode(200)
  @RequirePermissions("settings.manage")
  run() {
    return this.reminders.run();
  }
}

@Module({ controllers: [NotificationsController], providers: [NotificationsService, RemindersService], exports: [NotificationsService, RemindersService] })
export class NotificationsModule {}
