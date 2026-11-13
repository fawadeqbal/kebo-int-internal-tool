import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { SectionsService } from "./sections.service";

/** Where each stage of an order stands, read from its data. */
@ApiTags("order sections")
@Controller()
export class SectionsController {
  constructor(private readonly sections: SectionsService) {}

  /** One line per stage (word, facts, what is empty) and the word beside each tab. */
  @Get("orders/:id/sections")
  view(@CurrentUser() user: SessionUser, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.sections.view(user, id);
  }
}
