import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, SignedIn } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { HistoryService, historyQuery, type HistoryQuery } from "./history.service";

@ApiTags("history")
@Controller("history")
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  /** ?type=deal|order|customer|factory&id= — who changed what, when and why (newest first); ?step= an order's step only; ?limit= the newest n. */
  @SignedIn("checked inside: expenses.manage, sourcing.manage")
  @Get()
  list(@CurrentUser() user: SessionUser, @Query(Validate(historyQuery)) q: HistoryQuery) {
    return this.history.list(user, q);
  }
}
