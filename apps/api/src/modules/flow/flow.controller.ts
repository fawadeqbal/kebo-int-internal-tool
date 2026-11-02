import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  BANK_STEP_KINDS,
  bankContractInput,
  bankStepInput,
  claimInput,
  claimUpdateInput,
  deliveryAllGoodInput,
  deliveryInput,
  satAllPassedInput,
  factoryOrderInput,
  factoryRequestsInput,
  factoryRequestUpdateInput,
  orderDocumentInput,
  orderDocumentUpdateInput,
  paymentRouteInput,
  productionInput,
  satInput,
  shipmentInput,
  shipmentUpdateInput,
  type BankContractInput,
  type BankStepInput,
  type BankStepKind,
  type ClaimInput,
  type ClaimUpdateInput,
  type DeliveryAllGoodInput,
  type DeliveryInput,
  type SatAllPassedInput,
  type FactoryOrderInput,
  type FactoryRequestsInput,
  type FactoryRequestUpdateInput,
  type OrderDocumentInput,
  type OrderDocumentUpdateInput,
  type PaymentRouteInput,
  type ProductionInput,
  type SatInput,
  type ShipmentInput,
  type ShipmentUpdateInput,
} from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, RequireFeature, RequirePermissions } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { FlowService } from "./flow.service";
import { FactoryRequestsService } from "./factory-requests.service";

const uuid = new ParseUUIDPipe();
const stepParam = Validate(z.enum(BANK_STEP_KINDS));

/**
 * The order after the customer accepts. Every change answers with the whole
 * flow again (GET /orders/:id/flow), so a screen redraws from one reply.
 */
@ApiTags("order flow")
@Controller("orders")
export class OrderFlowController {
  constructor(private readonly flow: FlowService) {}

  /** The steps (payment → factory → production → shipping → documents & bank → delivery & SAT) and each module's data. */
  @Get(":id/flow")
  get(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string) {
    return this.flow.get(user, id);
  }

  /**
   * What a step's row fills in from earlier orders and the quote (nothing is saved): the forwarder of the last
   * order on this route, the banks of this customer's last LC, the quote's lead time and the factory's price basis.
   */
  @Get(":id/defaults")
  defaults(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string) {
    return this.flow.defaults(user, id);
  }

  /** { route: informal | bank_contract | letter_of_credit | null } */
  @Patch(":id/route")
  @RequirePermissions("orders.update")
  route(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string, @Body(Validate(paymentRouteInput)) body: PaymentRouteInput) {
    return this.flow.setRoute(user, id, body);
  }

  @Put(":id/bank-contract")
  @RequirePermissions("orders.update")
  @RequireFeature("bank_contracts")
  bankContract(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string, @Body(Validate(bankContractInput)) body: BankContractInput) {
    return this.flow.saveBankContract(user, id, body);
  }

  /** { factoryOrderedOn } — when we ordered from the factory (empty: not yet). */
  @Patch(":id/factory-order")
  @RequirePermissions("orders.update")
  factoryOrder(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string, @Body(Validate(factoryOrderInput)) body: FactoryOrderInput) {
    return this.flow.setFactoryOrder(user, id, body);
  }

  /** { steps: [{ id?, title, factoryId?, plannedOn?, doneOn?, note? }] } — the whole timeline, in order. */
  @Put(":id/production")
  @RequirePermissions("orders.update")
  @RequireFeature("production")
  production(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string, @Body(Validate(productionInput)) body: ProductionInput) {
    return this.flow.saveProduction(user, id, body);
  }

  @Post(":id/shipments")
  @RequirePermissions("shipping.manage")
  @RequireFeature("shipping")
  addShipment(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string, @Body(Validate(shipmentInput)) body: ShipmentInput) {
    return this.flow.addShipment(user, id, body);
  }

  /** One paper of the document set: { kind, status, number?, issuedOn?, shipmentId?, attachmentId?, title?, note? }. */
  @Post(":id/document-set")
  @RequirePermissions("documents.manage")
  @RequireFeature("bank_documents")
  addDocument(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string, @Body(Validate(orderDocumentInput)) body: OrderDocumentInput) {
    return this.flow.addDocument(user, id, body);
  }

  /** { doneOn, courier?, reference?, note? } — a step of the documents' trip through the banks. */
  @Put(":id/bank-steps/:step")
  @RequirePermissions("documents.manage")
  @RequireFeature("bank_documents")
  bankStep(
    @CurrentUser() user: SessionUser,
    @Param("id", uuid) id: string,
    @Param("step", stepParam) step: BankStepKind,
    @Body(Validate(bankStepInput)) body: BankStepInput,
  ) {
    return this.flow.setBankStep(user, id, step, body);
  }

  @Delete(":id/bank-steps/:step")
  @HttpCode(200)
  @RequirePermissions("documents.manage")
  @RequireFeature("bank_documents")
  clearBankStep(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string, @Param("step", stepParam) step: BankStepKind) {
    return this.flow.clearBankStep(user, id, step);
  }

  /** Delivery date and condition, the SAT engineer, dates and who signed. Only the fields sent change. */
  @Patch(":id/delivery")
  @RequirePermissions("delivery.manage")
  @RequireFeature("delivery_sat")
  delivery(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string, @Body(Validate(deliveryInput)) body: DeliveryInput) {
    return this.flow.saveDelivery(user, id, body);
  }

  /** { deliveredOn? } — "All delivered OK": every goods line in full and in good condition (today unless a day is sent). */
  @Post(":id/delivery/all-good")
  @HttpCode(200)
  @RequirePermissions("delivery.manage")
  @RequireFeature("delivery_sat")
  deliveryAllGood(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string, @Body(Validate(deliveryAllGoodInput)) body: DeliveryAllGoodInput) {
    return this.flow.deliveryAllGood(user, id, body);
  }

  /** { satDoneOn?, satSignedBy? } — "All passed": every open SAT point passes and the SAT is signed off. */
  @Post(":id/sat/all-passed")
  @HttpCode(200)
  @RequirePermissions("delivery.manage")
  @RequireFeature("delivery_sat")
  satAllPassed(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string, @Body(Validate(satAllPassedInput)) body: SatAllPassedInput) {
    return this.flow.satAllPassed(user, id, body);
  }

  /** { checks: [{ id?, item, result, note? }] } — the whole SAT checklist, in order. */
  @Put(":id/sat")
  @RequirePermissions("delivery.manage")
  @RequireFeature("delivery_sat")
  sat(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string, @Body(Validate(satInput)) body: SatInput) {
    return this.flow.saveSat(user, id, body);
  }

  @Post(":id/claims")
  @RequirePermissions("delivery.manage")
  @RequireFeature("delivery_sat")
  addClaim(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string, @Body(Validate(claimInput)) body: ClaimInput) {
    return this.flow.addClaim(user, id, body);
  }
}

@ApiTags("order flow")
@Controller("shipments")
export class ShipmentsController {
  constructor(private readonly flow: FlowService) {}

  @Patch(":id")
  @RequirePermissions("shipping.manage")
  @RequireFeature("shipping")
  update(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string, @Body(Validate(shipmentUpdateInput)) body: ShipmentUpdateInput) {
    return this.flow.updateShipment(user, id, body);
  }

  @Delete(":id")
  @HttpCode(200)
  @RequirePermissions("shipping.manage")
  @RequireFeature("shipping")
  remove(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string) {
    return this.flow.removeShipment(user, id);
  }
}

@ApiTags("order flow")
@Controller("order-documents")
export class OrderDocumentsController {
  constructor(private readonly flow: FlowService) {}

  @Patch(":id")
  @RequirePermissions("documents.manage")
  @RequireFeature("bank_documents")
  update(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string, @Body(Validate(orderDocumentUpdateInput)) body: OrderDocumentUpdateInput) {
    return this.flow.updateDocument(user, id, body);
  }

  @Delete(":id")
  @HttpCode(200)
  @RequirePermissions("documents.manage")
  @RequireFeature("bank_documents")
  remove(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string) {
    return this.flow.removeDocument(user, id);
  }
}

@ApiTags("order flow")
@Controller("claims")
export class ClaimsController {
  constructor(private readonly flow: FlowService) {}

  /** { title?, detail?, status?, resolution?, resolvedOn? } — closing a claim asks how it was settled. */
  @Patch(":id")
  @RequirePermissions("delivery.manage")
  @RequireFeature("delivery_sat")
  update(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string, @Body(Validate(claimUpdateInput)) body: ClaimUpdateInput) {
    return this.flow.updateClaim(user, id, body);
  }
}

@ApiTags("sourcing")
@Controller()
export class FactoryRequestsController {
  constructor(private readonly requests: FactoryRequestsService) {}

  /** The factories asked for a price on this inquiry, and who answered. */
  @Get("inquiries/:id/factory-requests")
  @RequirePermissions("sourcing.manage")
  @RequireFeature("factory_requests")
  list(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string) {
    return this.requests.list(user, id);
  }

  /** { factoryIds, sentOn?, replyBy?, note? } — send the spec to these factories. */
  @Post("inquiries/:id/factory-requests")
  @RequirePermissions("sourcing.manage")
  @RequireFeature("factory_requests")
  ask(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string, @Body(Validate(factoryRequestsInput)) body: FactoryRequestsInput) {
    return this.requests.ask(user, id, body);
  }

  @Patch("factory-requests/:id")
  @RequirePermissions("sourcing.manage")
  @RequireFeature("factory_requests")
  update(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string, @Body(Validate(factoryRequestUpdateInput)) body: FactoryRequestUpdateInput) {
    return this.requests.update(user, id, body);
  }

  @Delete("factory-requests/:id")
  @HttpCode(200)
  @RequirePermissions("sourcing.manage")
  @RequireFeature("factory_requests")
  remove(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string) {
    return this.requests.remove(user, id);
  }
}

@ApiTags("order flow")
@Controller("order-board")
export class OrderBoardController {
  constructor(private readonly flow: FlowService) {}

  /** ?mine=true — each open order's current step, for the board's columns. */
  @Get()
  @RequireFeature("orders_board")
  board(@CurrentUser() user: SessionUser, @Query(Validate(z.object({ mine: z.enum(["true", "false"]).optional() }))) q: { mine?: "true" | "false" }) {
    return this.flow.board(user, q.mine === "true");
  }
}
