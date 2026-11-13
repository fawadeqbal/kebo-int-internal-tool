"use server";

import { revalidatePath } from "next/cache";
import type { BankStepKind, ShipmentStatus } from "@kebo/shared";
import { api } from "@/lib/api";
import { attempt, formValues, reasonOf, type ActionState } from "@/lib/actions";
import type { OrderFlow, ShipmentView } from "@/lib/types-flow";
import type { OrderView } from "@/lib/types-orders";

/**
 * What a section's window sends when it saves a few fields or one thing in one
 * go. Each goes to the endpoint the full forms use (same permissions, history
 * and rules); nothing new is stored here. Forms send plain fields; a field
 * left out is not changed.
 */

const refresh = (orderId: string) => {
  revalidatePath(`/orders/${orderId}`, "layout");
  revalidatePath("/orders");
};

const SHIPMENT = [
  "mode",
  "status",
  "forwarder",
  "bookingNo",
  "blNo",
  "vessel",
  "portOfLoading",
  "portOfDischarge",
  "containerNo",
  "containerType",
  "sealNo",
  "loadedOn",
  "vgmKg",
  "etd",
  "eta",
  "departedOn",
  "arrivedOn",
  "note",
  "forwarderContact",
  "forwarderPhone",
  "customsBroker",
  "trackingNo",
  "freightAmount",
  "freightCurrency",
  "insurer",
  "insurancePolicyNo",
  "freightTerms",
  "insuredValue",
  "customsDeclarationNo",
  "clearedOn",
];
const CONTRACT = ["number", "status", "customerBank", "ourBank", "amount", "currency", "openedOn", "latestShipOn", "expiresOn", "note"];
const DELIVERY = ["deliveredOn", "deliveryNote", "deliveryReceivedBy", "satEngineerId", "satPlannedOn", "satDoneOn", "satSignedBy", "installedOn", "warrantyMonths"];
const DETAILS = ["shipBy", "readyOn", "shippedOn", "blNo", "portOfDischarge", "containerNo", "shippingMarks", "documentTitle", "customerRef", "customerPoOn", "consignee", "notifyParty", "deliveryAddress"];

/** A factory's own ready date field on the Factory card: "readyOn__<factory id>". */
const READY_OF = "readyOn__";

/** What a form says about the order's checks: it can ask (`ask`), or the person went ahead (`confirm`, with why). */
const ahead = (v: Record<string, string>) => ({
  ...(v.ask === "true" ? { ask: true } : {}),
  ...(v.confirm === "true" ? { confirm: true, reason: v.reason?.trim() || undefined } : {}),
});

const pick = (v: Record<string, string>, keys: string[]) => Object.fromEntries(keys.filter((k) => k in v).map((k) => [k, v[k]]));

/** A shipment only moves forward: planned → booked → loaded → departed → arrived (cleared stays). */
const ORDER: ShipmentStatus[] = ["planned", "booked", "loaded", "departed", "arrived", "cleared"];
const forward = (was: ShipmentStatus | undefined, to: ShipmentStatus) => (ORDER.indexOf(to) > ORDER.indexOf(was ?? "planned") ? to : undefined);

/** The status a shipment's values imply (a booking, a loading date, a sailing date, an arrival date), if further on. */
function impliedStatus(was: ShipmentStatus | undefined, v: Record<string, string>): ShipmentStatus | undefined {
  if (v.status) return undefined;
  if (v.arrivedOn) return forward(was, "arrived");
  if (v.departedOn) return forward(was, "departed");
  if (v.loadedOn) return forward(was, "loaded");
  if (v.bookingNo || v.forwarder) return forward(was, "booked");
  return undefined;
}

async function flowOf(orderId: string) {
  return api.get<OrderFlow>(`/orders/${orderId}/flow`);
}

/** Saves a shipment's fields (a new one's ports, when not typed, come from the order's terms: the API fills them), moving its status on with them. */
async function saveShipment(orderId: string, shipmentId: string | null, v: Record<string, string>, status?: ShipmentStatus) {
  const body: Record<string, unknown> = { ...pick(v, SHIPMENT), ...ahead(v) };
  let current: ShipmentView | undefined;
  if (shipmentId) current = (await flowOf(orderId)).shipping?.shipments.find((s) => s.id === shipmentId);
  const next = status ? forward(current?.status, status) : impliedStatus(current?.status, v);
  if (next) body.status = next;
  if (shipmentId) return api.patch(`/shipments/${shipmentId}`, body);
  return api.post(`/orders/${orderId}/shipments`, { mode: "sea", ...body });
}

/* ---------------------------------------------------------------- the view's "+ Add" and Edit */

/**
 * One value ("+ Add") or a whole card (Edit) of a step's view. `target`:
 * shipment:<id> | shipment:new | contract | factory | order | delivery.
 */
export async function fieldsAction(orderId: string, target: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const [kind, ref] = target.split(":");
  const r = await attempt(
    form,
    async () => {
      switch (kind) {
        case "shipment":
          return saveShipment(orderId, ref && ref !== "new" ? ref : null, v);
        case "contract": {
          // The contract is saved whole: what is there, with the values changed.
          const c = (await flowOf(orderId)).payment.bankContract;
          const was = Object.fromEntries(CONTRACT.map((k) => [k, c?.[k as keyof typeof c] ?? null]));
          const body = { ...was, ...pick(v, CONTRACT) };
          if (body.amount !== null && body.amount !== "" && !body.currency) body.currency = (await api.get<OrderView>(`/orders/${orderId}`)).currency;
          return api.put(`/orders/${orderId}/bank-contract`, body);
        }
        case "factory": {
          const fo = pick(v, ["factoryOrderedOn", "factoryOrderNo"]);
          const details: Record<string, unknown> = pick(v, ["readyOn", "shipBy"]);
          // One ready date per factory: "readyOn__<factory id>" fields are each factory's own.
          const each = Object.keys(v).filter((k) => k.startsWith(READY_OF));
          if (each.length) details.readyBy = each.map((k) => ({ factoryId: k.slice(READY_OF.length), readyOn: v[k] || null }));
          if (Object.keys(fo).length) await api.patch(`/orders/${orderId}/factory-order`, fo);
          if (Object.keys(details).length) await api.patch(`/orders/${orderId}/details`, { ...details, reason: reasonOf(form) });
          return null;
        }
        case "order":
          return api.patch(`/orders/${orderId}/details`, { ...pick(v, DETAILS), reason: reasonOf(form) });
        case "delivery":
          return api.patch(`/orders/${orderId}/delivery`, { ...pick(v, DELIVERY), ...ahead(v) });
        default:
          throw new Error(`Unknown card ${target}`);
      }
    },
    "Saved.",
  );
  if (r.ok) refresh(orderId);
  return { ...r, data: undefined };
}

/* ---------------------------------------------------------------- one window, one save */

/**
 * A window that saves one thing in one go. `what`:
 * - bank:<step> — a step at the bank (or the originals to the customer) done on the day sent, with the courier and its no.
 *   (the date emptied: the step is not done after all);
 * - delivered_all — every line delivered in good condition on the day sent;
 * - sat_all — every SAT point passed, signed off by the person named.
 */
export async function lightAction(orderId: string, what: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const [kind, ref = ""] = what.split(":");
  const r = await attempt(
    form,
    async () => {
      switch (kind) {
        case "bank":
          // The date emptied: the step is not done after all.
          if ("doneOn" in v && !v.doneOn) return api.delete(`/orders/${orderId}/bank-steps/${ref as BankStepKind}`);
          return api.put(`/orders/${orderId}/bank-steps/${ref as BankStepKind}`, {
            doneOn: v.doneOn || v.on,
            ...pick(v, ["courier", "reference", "note"]),
          });
        case "delivered_all":
          return api.post(`/orders/${orderId}/delivery/all-good`, { deliveredOn: v.deliveredOn || v.on || null });
        case "sat_all":
          return api.post(`/orders/${orderId}/sat/all-passed`, {
            satDoneOn: v.satDoneOn || v.on || null,
            ...("satSignedBy" in v ? { satSignedBy: v.satSignedBy } : {}),
          });
        default:
          throw new Error(`Unknown item ${what}`);
      }
    },
    "Saved.",
  );
  if (r.ok) refresh(orderId);
  return { ...r, data: undefined };
}
