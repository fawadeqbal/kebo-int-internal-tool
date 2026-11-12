import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  buyerRefreshInput,
  quotedTermsInput,
  type BuyerRefreshInput,
  type QuotedTermsInput,
  moveStageInput,
  ORDER_STAGES,
  orderDetailsInput,
  orderLineInput,
  packingInput,
  receiptInput,
  type MoveStageInput,
  type OrderDetailsInput,
  type OrderLineInput,
  type PackingInput,
  type ReceiptInput,
} from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { OrdersService } from "./orders.service";
import { DocumentsService, ORDER_DOCUMENTS, type OrderDocumentKind } from "./documents.service";

const docQuery = z.object({ v: z.coerce.number().int().min(1).max(999).optional() });
const flag = z.enum(["true", "false"]).optional().transform((v) => v === "true");
const listQuery = z.object({
  mine: flag,
  late: flag,
  status: z.enum(["open", "closed", "cancelled"]).optional(),
  stage: z.enum(ORDER_STAGES).optional(),
  /** The most recently moved first (the board's Done column), and at most this many. */
  recent: flag,
  limit: z.coerce.number().int().min(1).max(300).optional(),
  q: z.string().trim().max(100).optional(),
  customer: z.string().uuid().optional(),
});

const pageQuery = z.object({
  status: z.enum(["open", "late", "closed", "cancelled", "all"]).default("open"),
  /** Open orders at this stage. */
  stage: z.enum(ORDER_STAGES).optional(),
  customer: z.string().uuid().optional(),
  /** Who handles the order's inquiry. */
  assignee: z.string().uuid().optional(),
  mine: flag,
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

@ApiTags("orders")
@Controller("orders")
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly documents: DocumentsService,
  ) {}

  /** Orders with their stage, money due and what each needs now. ?status=open|closed|cancelled&stage=&mine=true&late=true */
  @Get()
  list(@CurrentUser() user: SessionUser, @Query(Validate(listQuery)) q: z.infer<typeof listQuery>) {
    return this.orders.list(user, { mine: q.mine, status: q.status, stage: q.stage, lateOnly: q.late, recent: q.recent, limit: q.limit, q: q.q, customerId: q.customer });
  }

  /** The orders list, a page at a time, with each status's count: ?status=open|late|closed|cancelled|all&mine=true&q&page&pageSize */
  @Get("page")
  page(@CurrentUser() user: SessionUser, @Query(Validate(pageQuery)) q: z.infer<typeof pageQuery>) {
    return this.orders.page(user, q);
  }

  /** How many orders: ?status=open|closed|cancelled&mine=true → { count }. */
  @Get("count")
  count(@CurrentUser() user: SessionUser, @Query(Validate(listQuery)) q: z.infer<typeof listQuery>) {
    return this.orders.count(user, { mine: q.mine, status: q.status });
  }

  /** The order: stage, the next button, money, what it needs, history, documents. */
  @Get(":id")
  get(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.orders.get(user, id);
  }

  /**
   * { to, confirm?, note?, readyOn?, shippedOn?, blNo? } — one stage forward or back.
   * A move with warnings answers 409 { code: "confirm", error: the warnings }; send it again with confirm: true.
   */
  @Post(":id/stage")
  @HttpCode(200)
  move(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(moveStageInput)) body: MoveStageInput) {
    return this.orders.moveStage(user, id, body);
  }

  /** { shipBy, readyOn, shippedOn, blNo } */
  @Patch(":id/details")
  details(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(orderDetailsInput)) body: OrderDetailsInput) {
    return this.orders.setDetails(user, id, body);
  }

  /** { on?, lines: [{ lineId, receivedQty }] } — how many of each goods line came in from the factory so far. */
  @Put(":id/receipt")
  receipt(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(receiptInput)) body: ReceiptInput) {
    return this.orders.recordReceipt(user, id, body);
  }

  /** { containerNo?, shippingMarks?, lines: [{ lineId, packages, packageType, netWeightKg, grossWeightKg, cbm }] } — the packing list. */
  @Put(":id/packing")
  packing(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(packingInput)) body: PackingInput) {
    return this.orders.savePacking(user, id, body);
  }

  /**
   * Issues the proforma: gives it its number (KEB260916TN07), dated today, and makes it final as it prints
   * now (the number never changes). Issued already with a next version open (Make again): that version is
   * made final.
   */
  @Post(":id/proforma")
  @HttpCode(200)
  issueProforma(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.orders.issueProforma(user, id);
  }

  /** { reason } — the buyer on the order's papers taken again from the customer (papers made from now on; final ones keep theirs). */
  @Post(":id/buyer")
  @HttpCode(200)
  refreshBuyer(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(buyerRefreshInput)) body: BuyerRefreshInput) {
    return this.orders.refreshBuyer(user, id, body.reason);
  }

  /** { print } — the quotation's own payment text on the papers although the route now differs (default: not printed). */
  @Post(":id/quoted-terms")
  @HttpCode(200)
  quotedTerms(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(quotedTermsInput)) body: QuotedTermsInput) {
    return this.orders.setQuotedTerms(user, id, body.print);
  }

  /** proforma | packing-list — the data to print (the web turns it into a page and a PDF): a final version as it was made (?v=), else from the order now. */
  @Get(":id/documents/:kind")
  document(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("kind", Validate(z.enum(ORDER_DOCUMENTS))) kind: OrderDocumentKind,
    @Query(Validate(docQuery)) q: z.infer<typeof docQuery>,
  ) {
    return this.documents.get(user, id, kind, q.v);
  }

  /** Make again: the next version as a draft (same number); the final one stays as it was printed. */
  @Post(":id/documents/:kind/again")
  @HttpCode(200)
  documentAgain(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Param("kind", Validate(z.enum(ORDER_DOCUMENTS))) kind: OrderDocumentKind) {
    return this.documents.again(user, id, kind);
  }

  /** The open version made final, as it prints now. */
  @Post(":id/documents/:kind/final")
  @HttpCode(200)
  documentFinal(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Param("kind", Validate(z.enum(ORDER_DOCUMENTS))) kind: OrderDocumentKind) {
    return this.documents.final(user, id, kind);
  }

  /** The next version's draft deleted. */
  @Delete(":id/documents/:kind/draft")
  documentDraftDelete(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Param("kind", Validate(z.enum(ORDER_DOCUMENTS))) kind: OrderDocumentKind) {
    return this.documents.removeDraft(user, id, kind);
  }
}

/**
 * One line of an order, in a step's line table. Lines are added and removed on
 * the order (the accepted quotation); here only what each step adds changes.
 */
@ApiTags("orders")
@Controller("order-lines")
export class OrderLinesController {
  constructor(private readonly orders: OrdersService) {}

  /**
   * { set: "received", receivedQty?, receivedOn? } (orders.update) ·
   * { set: "packing", packages?, packageType?, netWeightKg?, grossWeightKg?, cbm? } (orders.update) ·
   * { set: "delivered", deliveredQty?, condition?, note? } (delivery.manage, Delivery & SAT on).
   * Only the fields sent change. Answers { line, goods }.
   */
  @Patch(":id")
  edit(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(orderLineInput)) body: OrderLineInput) {
    return this.orders.editLine(user, id, body);
  }
}

@ApiTags("me")
@Controller("me")
export class MeController {
  constructor(private readonly orders: OrdersService) {}

  /** My to-do: what each open order I handle needs now, late ones first. */
  @Get("todo")
  todo(@CurrentUser() user: SessionUser) {
    return this.orders.todo(user);
  }
}
