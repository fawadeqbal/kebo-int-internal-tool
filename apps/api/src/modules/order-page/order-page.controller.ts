import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser, SignedIn } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { OrderPageService } from "./order-page.service";

@ApiTags("orders")
@Controller("orders")
export class OrderPageController {
  constructor(private readonly page: OrderPageService) {}

  /** Everything an order's frame shows, in one read: each part as its own endpoint answers it for this person. */
  @SignedIn("checked inside: each part as its own endpoint checks it")
  @Get(":id/page")
  read(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.page.read(user, id);
  }
}
