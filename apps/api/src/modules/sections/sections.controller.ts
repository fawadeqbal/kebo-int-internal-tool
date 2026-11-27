import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { supplierFactsInput, type SupplierFactsInput } from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, RequirePermissions, SignedIn } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { SectionsService } from "./sections.service";

/** Where each stage of an order stands, read from its data. */
@ApiTags("order sections")
@Controller()
export class SectionsController {
  constructor(private readonly sections: SectionsService) {}

  /** One line per stage (word, facts, what is empty) and the word beside each tab. */
  @SignedIn("anyone signed in to the company")
  @Get("orders/:id/sections")
  view(@CurrentUser() user: SessionUser, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.sections.view(user, id);
  }

  /** { supplierId?, readyToldOn?, readyToldVia?, readyNote?, fatPlannedOn?, fatAttendedById?, fatDoneOn?, fatResult?, fatRemarks?, goodsReceivedAt? } — Production's windows, for one supplier. */
  @Put("orders/:id/supplier-facts")
  @RequirePermissions("orders.update")
  supplierFacts(@CurrentUser() user: SessionUser, @Param("id", new ParseUUIDPipe()) id: string, @Body(Validate(supplierFactsInput)) input: SupplierFactsInput) {
    return this.sections.saveSupplierFacts(user, id, input);
  }
}
