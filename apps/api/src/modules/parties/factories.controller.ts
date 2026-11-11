import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { factoryImport, factoryInput, listQuery, type FactoryImport, type FactoryInput } from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, RequirePermissions, RequireFeature } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { FactoriesService } from "./factories.service";

/** ?mine=true: the factories I look after. */
const factoryList = listQuery.extend({ mine: z.enum(["true", "false"]).optional().transform((v) => v === "true") });

@ApiTags("factories")
@Controller("factories")
export class FactoriesController {
  constructor(private readonly factories: FactoriesService) {}

  @Get()
  @RequirePermissions("sourcing.manage")
  list(@CurrentUser() user: SessionUser, @Query(Validate(factoryList)) q: z.infer<typeof factoryList>) {
    return this.factories.list(user, q);
  }

  @Get(":id")
  @RequirePermissions("sourcing.manage")
  get(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.factories.get(id, user);
  }

  @Post()
  @RequirePermissions("sourcing.manage")
  create(@CurrentUser() user: SessionUser, @Body(Validate(factoryInput)) body: FactoryInput) {
    return this.factories.create(user, body);
  }

  /** New factories from an uploaded file: { added, skipped: [{ name, reason }] }. */
  @RequireFeature("excel")
  @Post("import")
  @HttpCode(200)
  @RequirePermissions("sourcing.manage")
  importMany(@CurrentUser() user: SessionUser, @Body(Validate(factoryImport)) body: FactoryImport) {
    return this.factories.importMany(user, body);
  }

  @Put(":id")
  @RequirePermissions("sourcing.manage")
  update(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(factoryInput)) body: FactoryInput) {
    return this.factories.update(user, id, body);
  }

  @Delete(":id")
  @HttpCode(200)
  @RequirePermissions("sourcing.manage")
  async remove(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.factories.remove(user, id);
    return { ok: true };
  }
}
