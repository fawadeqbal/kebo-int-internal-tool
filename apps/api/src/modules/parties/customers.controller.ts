import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { customerImport, customerInput, listQuery, type CustomerImport, type CustomerInput } from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, RequirePermissions, RequireFeature } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { CustomersService } from "./customers.service";

const customerList = listQuery.extend({ country: z.string().trim().toUpperCase().length(2).optional(), type: z.enum(["company", "individual"]).optional() });

@ApiTags("customers")
@Controller("customers")
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@CurrentUser() user: SessionUser, @Query(Validate(customerList)) q: z.infer<typeof customerList>) {
    return this.customers.list(user, q);
  }

  /** Every customer the person may see, by name: [{ id, name }] for pickers. */
  @Get("names")
  names(@CurrentUser() user: SessionUser) {
    return this.customers.names(user);
  }

  @Get(":id")
  get(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.customers.get(user, id);
  }

  /** 409 { code: "duplicate", matches } when a contact's email/phone is already known; resend with allowDuplicate. */
  @Post()
  @RequirePermissions("customers.manage")
  create(@CurrentUser() user: SessionUser, @Body(Validate(customerInput)) body: CustomerInput) {
    return this.customers.create(user, body);
  }

  /** New customers from an uploaded file: { added, skipped: [{ name, reason }] }. */
  @RequireFeature("excel")
  @Post("import")
  @HttpCode(200)
  @RequirePermissions("customers.manage")
  importMany(@CurrentUser() user: SessionUser, @Body(Validate(customerImport)) body: CustomerImport) {
    return this.customers.importMany(user, body);
  }

  @Put(":id")
  @RequirePermissions("customers.manage")
  update(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(customerInput)) body: CustomerInput) {
    return this.customers.update(user, id, body);
  }

  @Delete(":id")
  @HttpCode(200)
  @RequirePermissions("customers.delete")
  async remove(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.customers.remove(user, id);
    return { ok: true };
  }
}
