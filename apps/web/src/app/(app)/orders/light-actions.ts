"use server";

import { revalidatePath } from "next/cache";
import type { BankStepKind, ShipmentStatus } from "@kebo/shared";
import { api } from "@/lib/api";
import { attempt, formValues, reasonOf, type ActionState } from "@/lib/actions";
import type { OrderFlow, ShipmentView } from "@/lib/types-flow";
import type { OrderView } from "@/lib/types-orders";

/**
 * Order v4, light steps: what a checklist row's small form, a one-tap button
 * and a view card's "+ Add" / Edit send. Each goes to the endpoint the full
 * forms use (same permissions, history and rules); nothing new is stored here.
 * Forms send plain fields; a field left out is not changed.
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
];
const CONTRACT = ["number", "status", "customerBank", "ourBank", "amount", "currency", "openedOn", "latestShipOn", "expiresOn", "note"];
const DELIVERY = ["deliveredOn", "deliveryCondition", "deliveryNote", "deliveryReceivedBy", "satEngineerId", "satPlannedOn", "satDoneOn", "satSignedBy"];
const DETAILS = ["shipBy", "readyOn", "shippedOn", "blNo", "portOfDischarge", "containerNo", "shippingMarks", "documentTitle"];

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

/** Saves a shipment's fields (a new one starts from the order's ports), moving its status on with them. */
async function saveShipment(orderId: string, shipmentId: string | null, v: Record<string, string>, status?: ShipmentStatus) {
  const body: Record<string, unknown> = pick(v, SHIPMENT);
  let current: ShipmentView | undefined;
  if (shipmentId) current = (await flowOf(orderId)).shipping?.shipments.find((s) => s.id === shipmentId);
  const next = status ? forward(current?.status, status) : impliedStatus(current?.status, v);
  if (next) body.status = next;
  if (shipmentId) return api.patch(`/shipments/${shipmentId}`, body);
  const o = await api.get<OrderView>(`/orders/${orderId}`);
  return api.post(`/orders/${orderId}/shipments`, {
    mode: "sea",
    portOfLoading: o.incotermPlace ?? null,
    portOfDischarge: o.portOfDischarge ?? null,
    ...body,
  });
}

/** Files and a note kept with an automatic item; a person who may not change the checklist keeps the file in the deal's files only. */
async function keepWithItem(orderId: string, key: string, v: Record<string, string>) {
  const body = { ...(v.attachmentId ? { attachmentId: v.attachmentId } : {}), ...(v.itemNote ? { note: v.itemNote } : {}) };
  if (!Object.keys(body).length) return null;
  try {
    await api.put(`/orders/${orderId}/checklist/auto/${key}`, body);
    return null;
  } catch {
    return "Saved. The file stays in the deal's files (you cannot keep it with the item).";
  }
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
          const details = pick(v, ["readyOn", "shipBy"]);
          if (Object.keys(fo).length) await api.patch(`/orders/${orderId}/factory-order`, fo);
          if (Object.keys(details).length) await api.patch(`/orders/${orderId}/details`, { ...details, reason: reasonOf(form) });
          return null;
        }
        case "order":
          return api.patch(`/orders/${orderId}/details`, { ...pick(v, DETAILS), reason: reasonOf(form) });
        case "delivery":
          return api.patch(`/orders/${orderId}/delivery`, pick(v, DELIVERY));
        default:
          throw new Error(`Unknown card ${target}`);
      }
    },
    "Saved.",
  );
  if (r.ok) refresh(orderId);
  return { ...r, data: undefined };
}

/* ---------------------------------------------------------------- the checklist's light rows and one-tap items */

/**
 * A light row's "Save and tick", or a one-tap button. `what`:
 * - booked:<shipment id | new>, loaded:<…>, sailed:<…>[:air] — the shipment's fields (status moves on);
 * - arrived:<id,id…> — every listed shipment arrived on the day sent (today);
 * - ordered — the day we ordered from the factory (today) and their order no.;
 * - ready — the ready date;
 * - received_all — every goods line in full;
 * - contract — the LC / bank contract's number, amount, expiry, banks (opened);
 * - bank:<step> — a bank step done on the day sent (today), with the courier no.;
 * - delivered_all — every line delivered in good condition;
 * - sat_all — every SAT point passed, signed off by the person named.
 */
export async function lightAction(orderId: string, what: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const [kind, ref = "", extra] = what.split(":");
  let note: string | null = null;
  const r = await attempt(
    form,
    async () => {
      switch (kind) {
        case "booked":
        case "loaded":
        case "sailed": {
          const status: ShipmentStatus = kind === "booked" ? "booked" : kind === "loaded" ? "loaded" : "departed";
          await saveShipment(orderId, ref && ref !== "new" ? ref : null, v, status);
          // The B/L copy also goes into the paper set (when the papers module is on and the person keeps papers).
          if (kind === "sailed" && v.attachmentId)
            await api
              .post(`/orders/${orderId}/document-set`, {
                kind: extra === "air" ? "airway_bill" : "bill_of_lading",
                status: "ready",
                number: v.blNo ?? null,
                issuedOn: v.departedOn ?? null,
                attachmentId: v.attachmentId,
                note: "Copy",
              })
              .catch(() => null);
          note = await keepWithItem(orderId, kind, v);
          return null;
        }
        case "arrived": {
          const on = v.arrivedOn || v.on;
          for (const id of ref.split(",").filter(Boolean)) await api.patch(`/shipments/${id}`, { status: "arrived", arrivedOn: on });
          return null;
        }
        case "ordered":
          await api.patch(`/orders/${orderId}/factory-order`, {
            factoryOrderedOn: v.factoryOrderedOn || v.on,
            ...(v.factoryOrderNo ? { factoryOrderNo: v.factoryOrderNo } : {}),
          });
          note = await keepWithItem(orderId, "factory_ordered", v);
          return null;
        case "ready":
          return api.patch(`/orders/${orderId}/details`, { readyOn: v.readyOn || null, reason: reasonOf(form) });
        case "received_all": {
          const o = await api.get<OrderView>(`/orders/${orderId}`);
          const lines = o.lines.filter((l) => l.type === "goods").map((l) => ({ lineId: l.id, receivedQty: Number(l.quantity) }));
          return api.put(`/orders/${orderId}/receipt`, { on: v.on || null, lines });
        }
        case "contract": {
          const c = (await flowOf(orderId)).payment.bankContract;
          const was = Object.fromEntries(CONTRACT.map((k) => [k, c?.[k as keyof typeof c] ?? null]));
          const body: Record<string, unknown> = { ...was, ...pick(v, CONTRACT) };
          if (!body.status || body.status === "draft") body.status = "opened";
          if (body.amount !== null && body.amount !== "" && !body.currency) body.currency = (await api.get<OrderView>(`/orders/${orderId}`)).currency;
          await api.put(`/orders/${orderId}/bank-contract`, body);
          note = await keepWithItem(orderId, "contract", v);
          return null;
        }
        case "bank":
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
  return { ...r, message: r.ok ? (note ?? r.message) : r.message, data: undefined };
}
