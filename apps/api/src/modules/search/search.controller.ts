import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { searchQuery, type SearchQuery } from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, SignedIn } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { SearchService } from "./search.service";

@ApiTags("search")
@Controller("search")
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /** ?q=kabul&kind=orders&limit=3: each kind with how many are found and the first of them, and a number typed whole. */
  @SignedIn("anyone signed in to the company; each kind only as far as its own list shows it")
  @Get()
  find(@CurrentUser() user: SessionUser, @Query(Validate(searchQuery)) q: SearchQuery) {
    return this.search.find(user, q);
  }
}
