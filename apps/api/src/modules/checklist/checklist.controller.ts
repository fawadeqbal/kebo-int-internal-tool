import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  checklistAutoInput,
  checklistItemInput,
  checklistItemUpdateInput,
  checklistSkipInput,
  checklistTemplateInput,
  checklistTickInput,
  type ChecklistAutoInput,
  type ChecklistItemInput,
  type ChecklistItemUpdateInput,
  type ChecklistSkipInput,
  type ChecklistTemplateInput,
  type ChecklistTickInput,
} from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, RequirePermissions } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { ChecklistService } from "./checklist.service";
import { ChecklistTemplatesService } from "./checklist-templates.service";

const uuid = new ParseUUIDPipe();
const keyParam = Validate(z.string().regex(/^[a-z_]+(:[a-z_]+)?$/, "Unknown item"));

/** An order's steps and checklist. Every change answers with the whole checklist again. */
@ApiTags("order checklist")
@Controller()
export class ChecklistController {
  constructor(private readonly checklist: ChecklistService) {}

  /** The steps (state, n of m, one line, next item), "do this now", and every item. */
  @Get("orders/:id/steps")
  steps(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string) {
    return this.checklist.view(user, id);
  }

  /** { step, title, tool?, fields?, route?, dueOn?, assigneeId?, note? } — an item added on the order. */
  @Post("orders/:id/checklist")
  @RequirePermissions("orders.update")
  add(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string, @Body(Validate(checklistItemInput)) body: ChecklistItemInput) {
    return this.checklist.add(user, id, body);
  }

  /** An automatic item's overrides: { dueOn?, assigneeId?, note?, skipped?, skipReason? }. */
  @Put("orders/:id/checklist/auto/:key")
  @RequirePermissions("orders.update")
  auto(
    @CurrentUser() user: SessionUser,
    @Param("id", uuid) id: string,
    @Param("key", keyParam) key: string,
    @Body(Validate(checklistAutoInput)) body: ChecklistAutoInput,
  ) {
    return this.checklist.auto(user, id, key, body);
  }

  @Patch("checklist/:id")
  @RequirePermissions("orders.update")
  update(
    @CurrentUser() user: SessionUser,
    @Param("id", uuid) id: string,
    @Body(Validate(checklistItemUpdateInput)) body: ChecklistItemUpdateInput,
  ) {
    return this.checklist.update(user, id, body);
  }

  /** { data?, attachmentId? } — done, with what the item's form collected. */
  @Post("checklist/:id/tick")
  @HttpCode(200)
  @RequirePermissions("orders.update")
  tick(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string, @Body(Validate(checklistTickInput)) body: ChecklistTickInput) {
    return this.checklist.tick(user, id, body);
  }

  @Post("checklist/:id/untick")
  @HttpCode(200)
  @RequirePermissions("orders.update")
  untick(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string) {
    return this.checklist.untick(user, id);
  }

  /** { reason } */
  @Post("checklist/:id/skip")
  @HttpCode(200)
  @RequirePermissions("orders.update")
  skip(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string, @Body(Validate(checklistSkipInput)) body: ChecklistSkipInput) {
    return this.checklist.skip(user, id, body.reason);
  }

  @Delete("checklist/:id")
  @HttpCode(200)
  @RequirePermissions("orders.update")
  remove(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string) {
    return this.checklist.remove(user, id);
  }
}

/** The company's own list (Settings › Order checklist). */
@ApiTags("settings")
@Controller("settings/checklist")
export class ChecklistTemplatesController {
  constructor(private readonly templates: ChecklistTemplatesService) {}

  @Get()
  @RequirePermissions("settings.manage")
  get(@CurrentUser() user: SessionUser) {
    return this.templates.get(user);
  }

  /** { items: [{ step, title, tool, fields, route, dueDays }], hidden: [auto keys] } — the whole list at once. */
  @Put()
  @RequirePermissions("settings.manage")
  save(@CurrentUser() user: SessionUser, @Body(Validate(checklistTemplateInput)) body: ChecklistTemplateInput) {
    return this.templates.save(user, body);
  }
}
