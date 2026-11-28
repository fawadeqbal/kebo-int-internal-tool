import { HttpException, Injectable, Logger } from "@nestjs/common";
import { followUpListQuery, isFailed, type Failed } from "@kebo/shared";
import { ForbiddenError, NotFoundError } from "@kebo/utils";
import type { SessionUser } from "../../common/auth/session-user";
import { OrdersService } from "../orders/orders.service";
import { SectionsService } from "../sections/sections.service";
import { FlowService } from "../flow/flow.service";
import { OrderFilesService } from "../files/order-files.service";
import { MoneyService } from "../money/money.service";
import { CostsService } from "../money/costs.service";
import { PapersService } from "../papers/papers.service";
import { NotesService } from "../notes/notes.service";
import { FollowUpsService } from "../notes/follow-ups.service";
import { UsersService } from "../users/users.service";
import { CustomersService } from "../parties/customers.service";

/**
 * A part: what its own endpoint answers; null when this person may not see it (that endpoint's 403 or 404); a
 * Failed (@kebo/shared) when it could not be read: logged here, and said in its place on the page ("Could not load").
 */
type Part<T> = T | null | Failed;

/** Not this person's to see: the endpoint would answer 403 or 404. */
const notTheirs = (e: unknown) =>
  e instanceof ForbiddenError || e instanceof NotFoundError || (e instanceof HttpException && [403, 404].includes(e.getStatus()));

/**
 * GET /orders/:id/page — everything an order's frame shows (its top, tabs and side, on every tab), in one read
 * (architecture review 27 Nov: one read per screen; the page asked 12 times, each loading the order again).
 *
 * Each part is what its own endpoint answers for this person, read by the same service with the same checks: the
 * order (its 404 is the page's), its stages' words, the flow, the files, the money, the costs, the papers, the
 * notes, the purchase orders, the open follow-ups, the customer's contacts and the people to tell. A part this
 * person may not see is null; one that fails is logged and named, and the rest still comes. What two parts both
 * need is read once: the money (the stages read the suppliers' money from it), the papers (the files list them).
 */
@Injectable()
export class OrderPageService {
  private readonly log = new Logger("OrderPage");

  constructor(
    private readonly orders: OrdersService,
    private readonly sections: SectionsService,
    private readonly flow: FlowService,
    private readonly files: OrderFilesService,
    private readonly money: MoneyService,
    private readonly costs: CostsService,
    private readonly papers: PapersService,
    private readonly notes: NotesService,
    private readonly followUps: FollowUpsService,
    private readonly users: UsersService,
    private readonly customers: CustomersService,
  ) {}

  async read(user: SessionUser, id: string) {
    // The order first: a page of an order that is not there (or not theirs) is the page's 404, as before.
    const order = await this.orders.get(user, id);
    const part = async <T>(what: string, read: () => Promise<T>): Promise<Part<T>> => {
      try {
        return await read();
      } catch (e) {
        if (notTheirs(e)) return null;
        this.log.error(
          `could not read ${what} of order ${id}: ${e instanceof Error ? e.message : String(e)}`,
          e instanceof Error ? e.stack : undefined,
        );
        return { failed: true, what };
      }
    };
    const readOnce = <T>(p: Part<T>): T | undefined => (p === null || isFailed(p) ? undefined : p);
    // Every part starts at once. The money and the papers are read once and given to the two parts that need them
    // too (the stages' words, the files), which start when those are in; a failed one is read again there.
    const money = part("the money", () => this.money.forOrder(user, id));
    const papers = part("the papers", () => this.papers.list(user, id));
    const [sections, flow, files, costs, notes, purchaseOrders, followUps, customer, people] = await Promise.all([
      money.then((m) => part("where each stage stands", () => this.sections.view(user, id, { money: readOnce(m) }))),
      part("the flow", () => this.flow.get(user, id)),
      papers.then((p) => part("the files", () => this.files.list(user, id, { papers: readOnce(p) }))),
      part("the costs", () => this.costs.forOrder(user, id)),
      part("the notes", () => this.notes.list(user, "order", id)),
      part("the purchase orders", () => this.flow.purchaseOrders(user, id)),
      part("the follow-ups", () => this.followUps.list(user, followUpListQuery.parse({ orderId: id, open: "true" }))),
      part("the customer's contacts", async () => (await this.customers.get(user, order.customer.id)).contacts),
      part("the people to tell", () => this.users.people()),
    ]);
    return {
      order,
      sections,
      flow,
      files,
      money: await money,
      costs,
      papers: await papers,
      notes,
      purchaseOrders,
      followUps,
      customerContacts: customer,
      people,
    };
  }
}
