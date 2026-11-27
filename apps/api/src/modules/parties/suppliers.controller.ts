import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { supplierImport, supplierInput, listQuery, type SupplierImport, type SupplierInput } from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, RequirePermissions, RequireFeature } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { SuppliersService } from "./suppliers.service";
import { Versioned } from "../../common/http/version";

/** ?mine=true: the suppliers I look after. */
const blank = (v: unknown) => (v === "" ? undefined : v);
const supplierList = listQuery.extend({
  mine: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
  /** Who looks after it ("none": nobody yet). */
  owner: z.preprocess(blank, z.union([z.uuid(), z.literal("none")]).optional()),
  /** Its city (the end of its address). */
  city: z.preprocess(blank, z.string().trim().max(80).optional()),
  /** offers: has sent prices; none: none yet. */
  status: z.preprocess(blank, z.enum(["offers", "none"]).optional()),
});

@ApiTags("factories")
@Controller("suppliers")
export class SuppliersController {
  constructor(private readonly factories: SuppliersService) {}

  @Get()
  @RequirePermissions("sourcing.manage")
  list(@CurrentUser() user: SessionUser, @Query(Validate(supplierList)) q: z.infer<typeof supplierList>) {
    return this.factories.list(user, q);
  }

  @Get(":id")
  @RequirePermissions("sourcing.manage")
  get(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.factories.get(id, user);
  }

  @Post()
  @RequirePermissions("sourcing.manage")
  create(@CurrentUser() user: SessionUser, @Body(Validate(supplierInput)) body: SupplierInput) {
    return this.factories.create(user, body);
  }

  /** New suppliers from an uploaded file: { added, skipped: [{ name, reason }] }. */
  @RequireFeature("excel")
  @Post("import")
  @HttpCode(200)
  @RequirePermissions("sourcing.manage")
  importMany(@CurrentUser() user: SessionUser, @Body(Validate(supplierImport)) body: SupplierImport) {
    return this.factories.importMany(user, body);
  }

  @Versioned("parties")
  @Put(":id")
  @RequirePermissions("sourcing.manage")
  update(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(supplierInput)) body: SupplierInput) {
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
