import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { factoryFactsInput, type FactoryFactsInput } from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, RequirePermissions } from "../../common/auth/decorators";
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

  /** { factoryId?, readyToldOn?, readyToldVia?, readyNote?, fatPlannedOn?, fatAttendedById?, fatDoneOn?, fatResult?, fatRemarks?, goodsReceivedAt? } — Production's windows, for one factory. */
  @Put("orders/:id/factory-facts")
  @RequirePermissions("orders.update")
  factoryFacts(@CurrentUser() user: SessionUser, @Param("id", new ParseUUIDPipe()) id: string, @Body(Validate(factoryFactsInput)) input: FactoryFactsInput) {
    return this.sections.saveFactoryFacts(user, id, input);
  }
}
