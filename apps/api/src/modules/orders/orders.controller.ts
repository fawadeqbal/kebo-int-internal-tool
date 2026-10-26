import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { cancelOrderInput, orderDatesInput, stepActionInput, stepDueInput, type StepActionInput } from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { OrdersService } from "./orders.service";

const listQuery = z.object({
  mine: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
  overdue: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
  status: z.enum(["open", "closed", "cancelled"]).optional(),
});

@ApiTags("orders")
@Controller("orders")
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** Orders with their stage and next step. ?mine=true&overdue=true&status=open */
  @Get()
  list(@CurrentUser() user: SessionUser, @Query(Validate(listQuery)) q: z.infer<typeof listQuery>) {
    return this.orders.list(user, { mine: q.mine, overdueOnly: q.overdue, status: q.status });
  }

  /** The order, its money position and its full checklist with the next step. */
  @Get(":id")
  get(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.orders.get(user, id);
  }

  /** { action: done|skip|undo, key, on?, note? } — returns the updated order and plan. */
  @Post(":id/steps")
  @HttpCode(200)
  step(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(stepActionInput)) body: StepActionInput) {
    return this.orders.applyStep(user, id, body);
  }

  /** { key, due } — a typed due date for one step (null = back to the calculated one). */
  @Patch(":id/steps/due")
  due(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(stepDueInput)) body: z.infer<typeof stepDueInput>) {
    return this.orders.setStepDue(user, id, body.key, body.due);
  }

  /** { reason } — managers only; the deal becomes lost (customer cancelled) and can be reopened. */
  @Post(":id/cancel")
  @HttpCode(200)
  cancel(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(cancelOrderInput)) body: z.infer<typeof cancelOrderInput>) {
    return this.orders.cancel(user, id, body.reason);
  }

  /** { shipBy, readyOn } */
  @Patch(":id/dates")
  dates(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(orderDatesInput)) body: z.infer<typeof orderDatesInput>) {
    return this.orders.setDates(user, id, body);
  }
}

@ApiTags("me")
@Controller("me")
export class MeController {
  constructor(private readonly orders: OrdersService) {}

  /** My to-do: the next step of every open order I handle, late ones first. */
  @Get("todo")
  todo(@CurrentUser() user: SessionUser) {
    return this.orders.todo(user);
  }
}
