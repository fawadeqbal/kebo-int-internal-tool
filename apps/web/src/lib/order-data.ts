import "server-only";
import { cache } from "react";
import { api, ApiError } from "./api";
import { load } from "./session";
import { isFailed, type Failed } from "@kebo/shared";
import type { OrderCosts, OrderMoney } from "./types-money";
import type { OrderView, PaymentsView } from "./types-orders";
import type { OrderDefaults, OrderFlow } from "./types-flow";
import type { OrderPapers } from "./types-papers";
import type { OrderFiles } from "./types-files";
import type { OrderSectionsView } from "./types-sections";
import type { FollowUpList, Note } from "./types-notes";
import type { CustomerDetail } from "./types-people";
import type { PersonWithRole } from "./types-deals";
import type { PurchaseOrderView } from "@/components/orders/purchase-order-card";

/** The order's purchase orders (one per supplier on its lines) and the deposit they wait for. */
export interface OrderPurchaseOrders {
  deposit: { asked: string; paid: string; verified: boolean };
  items: PurchaseOrderView[];
}

/** A part of the order page's read: what its own endpoint answers; null when this person may not see it; a Failed when it could not be read. */
type PagePart<T> = T | null | Failed;

/** GET /orders/:id/page: the order, and each other part as its own endpoint answers it for this person. */
export interface OrderPageRead {
  order: OrderView;
  sections: PagePart<OrderSectionsView>;
  flow: PagePart<OrderFlow>;
  files: PagePart<OrderFiles>;
  money: PagePart<OrderMoney>;
  costs: PagePart<OrderCosts>;
  papers: PagePart<OrderPapers>;
  notes: PagePart<Note[]>;
  purchaseOrders: PagePart<OrderPurchaseOrders>;
  /** The open ones (GET /follow-ups?orderId=…&open=true). */
  followUps: PagePart<FollowUpList>;
  customerContacts: PagePart<CustomerDetail["contacts"]>;
  people: PagePart<PersonWithRole[]>;
}

/**
 * An order's own pages (its top, tabs and side, every tab, their titles) read the order once per request: one call
 * (GET /orders/:id/page) instead of one per part, each loading the order again (architecture review 27 Nov). The
 * readers below take their part from it, so a layout, a tab and a card asking for the same part make no new call.
 *
 * A purchase order's page reads it too (it shows the order's stage data). Pages elsewhere that need one part of an
 * order (a payment, a new payment, money due) read only that part: orderAloneOf, orderMoneyAloneOf.
 */
export const orderPageOf = cache((id: string) => api.get<OrderPageRead>(`/orders/${id}/page`));

type Part = Exclude<keyof OrderPageRead, "order">;

/**
 * One part of the page's read, answered the way its own endpoint was: its data; an ApiError 403 when this person
 * may not see it (optional() and part() leave it out, as before); an ApiError 500 when the API could not read it
 * (part() says "Could not load" in its place; optional() goes on to the error page, as before). When the whole read
 * fails (the order is not theirs, the server is down), every part fails the same way.
 */
async function partOf<K extends Part>(id: string, key: K): Promise<Exclude<OrderPageRead[K], null | Failed>> {
  const p = (await orderPageOf(id))[key];
  if (p === null) throw new ApiError(403, "Not there for this person");
  if (isFailed(p)) throw new ApiError(500, `The order page could not read ${p.what}`, { code: "part_failed" });
  return p as Exclude<OrderPageRead[K], null | Failed>;
}

/** The order (its 404 and 403 are the page's: not found, or the forbidden page). */
export const orderOf = cache((id: string) => load(async () => (await orderPageOf(id)).order));
export const orderMoneyOf = cache((id: string) => partOf(id, "money"));
/** The order's costs and profit (managers with the expenses feature; 403 otherwise). */
export const orderCostsOf = cache((id: string) => partOf(id, "costs"));
/** The flow after acceptance (payment route, production, shipping, papers and banks, delivery and SAT). */
export const orderFlowOf = cache((id: string) => partOf(id, "flow"));
/** Every paper of the order with where it stands (step pages, Documents). */
export const orderPapersOf = cache((id: string) => partOf(id, "papers"));
/** Every file of the order in one list (Documents v3). */
export const orderFilesOf = cache((id: string) => partOf(id, "files"));
/** Where each stage stands (its word, a line of facts, what is empty), read from the order's data. */
export const orderSectionsOf = cache((id: string) => partOf(id, "sections"));
/** The order's notes, newest first. */
export const orderNotesOf = cache((id: string) => partOf(id, "notes"));
/** The order's purchase orders (one per supplier on its lines) and the deposit they wait for. */
export const orderPurchaseOrdersOf = cache((id: string) => partOf(id, "purchaseOrders"));
/** The order's open follow-ups. */
export const orderOpenFollowUpsOf = cache((id: string) => partOf(id, "followUps"));
/** Who the order's Email and Share go to: its customer's contacts. */
export const orderCustomerContactsOf = cache((id: string) => partOf(id, "customerContacts"));
/** The company's active people, for the order's pickers and "tell" lists (GET /users/people). */
export const orderPeopleOf = cache((id: string) => partOf(id, "people"));

/* Not in the page's read: what only a tab or two needs. */
export const orderPaymentsOf = cache((id: string) => api.get<PaymentsView>(`/orders/${id}/payments`));
/** What a step's row fills in from earlier orders and the quote (the forwarder, the banks, the lead time). */
export const orderDefaultsOf = cache((id: string) => api.get<OrderDefaults>(`/orders/${id}/defaults`));

/* Pages elsewhere than the order's own: one endpoint each, not the order page's whole read. */
export const orderAloneOf = cache((id: string) => load(() => api.get<OrderView>(`/orders/${id}`)));
export const orderMoneyAloneOf = cache((id: string) => api.get<OrderMoney>(`/orders/${id}/money`));
