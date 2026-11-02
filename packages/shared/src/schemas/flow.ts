import { z } from "zod";
import {
  BANK_CONTRACT_STATUSES,
  CLAIM_STATUSES,
  CURRENCIES,
  DELIVERY_CONDITIONS,
  FACTORY_REQUEST_STATUSES,
  ORDER_DOCUMENT_KINDS,
  ORDER_DOCUMENT_STATUSES,
  PAYMENT_ROUTES,
  SAT_RESULTS,
  SHIP_MODES,
  SHIPMENT_STATUSES,
} from "../enums";
import { REQUEST_CHANNELS } from "../workflows/flow";
import { BALANCE_WHENS, LC_TERMS } from "../workflows/money-route";
import { id, isoDate, optionalAmount, optionalDate, optionalId, optionalText, text } from "./common";

/**
 * Inputs for the order flow after the quotation (see workflows/flow). Where a
 * schema is for a change (PATCH), only the fields sent change; an empty field clears it.
 */

const maybe = <T extends z.ZodTypeAny>(s: T) => s.optional();
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (v === "" ? null : v), z.enum(values).nullable());

/* ---------------------------------------------------------------- asking factories */

/** Send the inquiry's spec to these factories (one request each; a factory already asked is left as it is). */
export const factoryRequestsInput = z.object({
  factoryIds: z.array(id("Choose the factories to ask")).min(1, "Choose at least one factory").max(30),
  channel: optionalEnum(REQUEST_CHANNELS).optional().transform((v) => v ?? null),
  sentOn: optionalDate,
  replyBy: optionalDate,
  note: optionalText(500),
});
export type FactoryRequestsInput = z.infer<typeof factoryRequestsInput>;

export const factoryRequestUpdateInput = z.object({
  status: maybe(z.enum(FACTORY_REQUEST_STATUSES)),
  channel: maybe(optionalEnum(REQUEST_CHANNELS)),
  replyBy: maybe(optionalDate),
  factoryQuoteId: maybe(optionalId),
  note: maybe(optionalText(500)),
});
export type FactoryRequestUpdateInput = z.infer<typeof factoryRequestUpdateInput>;

/* ---------------------------------------------------------------- payment route and bank contract */

/**
 * How the customer pays, and the route's terms (the route builds the plan):
 * informal → the balance before shipment or against the B/L copy; LC → at
 * sight or deferred N days. Terms not sent stay as they are.
 */
export const paymentRouteInput = z.object({
  route: optionalEnum(PAYMENT_ROUTES),
  balanceWhen: z.preprocess((v) => (v === "" ? undefined : v), z.enum(BALANCE_WHENS).optional()),
  lcTerms: z.preprocess((v) => (v === "" ? undefined : v), z.enum(LC_TERMS).optional()),
  lcDays: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int("Whole days").min(0).max(720).optional()),
});
export type PaymentRouteInput = z.infer<typeof paymentRouteInput>;

export const bankContractInput = z.object({
  number: optionalText(60),
  status: z.enum(BANK_CONTRACT_STATUSES).default("draft"),
  customerBank: optionalText(160),
  ourBank: optionalText(160),
  amount: optionalAmount,
  currency: optionalEnum(CURRENCIES).optional().transform((v) => v ?? null),
  openedOn: optionalDate,
  latestShipOn: optionalDate,
  expiresOn: optionalDate,
  note: optionalText(2000),
});
export type BankContractInput = z.infer<typeof bankContractInput>;

/** When we placed the order with the factory (empty: not yet). */
export const factoryOrderInput = z.object({ factoryOrderedOn: optionalDate });
export type FactoryOrderInput = z.infer<typeof factoryOrderInput>;

/* ---------------------------------------------------------------- production */

/** The whole production timeline, in order: steps sent with an id are kept and changed, others are added, missing ones removed. */
export const productionInput = z.object({
  steps: z
    .array(
      z.object({
        id: optionalId,
        title: text(120, "Name the step"),
        factoryId: optionalId,
        plannedOn: optionalDate,
        doneOn: optionalDate,
        note: optionalText(500),
      }),
    )
    .max(40),
});
export type ProductionInput = z.infer<typeof productionInput>;

/* ---------------------------------------------------------------- shipping */

const shipmentFields = {
  mode: z.enum(SHIP_MODES),
  status: z.enum(SHIPMENT_STATUSES),
  forwarder: optionalText(120),
  bookingNo: optionalText(60),
  blNo: optionalText(60),
  vessel: optionalText(120),
  portOfLoading: optionalText(120),
  portOfDischarge: optionalText(120),
  containerNo: optionalText(120),
  containerType: optionalText(20),
  etd: optionalDate,
  eta: optionalDate,
  departedOn: optionalDate,
  arrivedOn: optionalDate,
  note: optionalText(2000),
};
const etaAfterEtd = (v: { etd?: string | null; eta?: string | null }) => !v.etd || !v.eta || v.eta >= v.etd;
const etaMessage = { message: "The arrival date (ETA) cannot be before the departure date (ETD)", path: ["eta"] };

export const shipmentInput = z
  .object({ ...shipmentFields, mode: shipmentFields.mode.default("sea"), status: shipmentFields.status.default("planned") })
  .refine(etaAfterEtd, etaMessage);
export type ShipmentInput = z.infer<typeof shipmentInput>;

export const shipmentUpdateInput = z
  .object(Object.fromEntries(Object.entries(shipmentFields).map(([k, v]) => [k, v.optional()])) as { [K in keyof typeof shipmentFields]: z.ZodOptional<(typeof shipmentFields)[K]> })
  .refine(etaAfterEtd, etaMessage);
export type ShipmentUpdateInput = z.infer<typeof shipmentUpdateInput>;

/* ---------------------------------------------------------------- documents and the bank chain */

const documentFields = {
  shipmentId: optionalId,
  title: optionalText(120),
  number: optionalText(60),
  issuedOn: optionalDate,
  status: z.enum(ORDER_DOCUMENT_STATUSES),
  /** A file already on the deal (uploaded to the inquiry's files). */
  attachmentId: optionalId,
  note: optionalText(500),
};

export const orderDocumentInput = z.object({ kind: z.enum(ORDER_DOCUMENT_KINDS), ...documentFields, status: documentFields.status.default("draft") });
export type OrderDocumentInput = z.infer<typeof orderDocumentInput>;

export const orderDocumentUpdateInput = z.object(
  Object.fromEntries(Object.entries(documentFields).map(([k, v]) => [k, v.optional()])) as { [K in keyof typeof documentFields]: z.ZodOptional<(typeof documentFields)[K]> },
);
export type OrderDocumentUpdateInput = z.infer<typeof orderDocumentUpdateInput>;

export const bankStepInput = z.object({
  doneOn: isoDate(),
  courier: optionalText(60),
  reference: optionalText(120),
  note: optionalText(500),
});
export type BankStepInput = z.infer<typeof bankStepInput>;

/* ---------------------------------------------------------------- delivery, SAT, claims */

export const deliveryInput = z.object({
  deliveredOn: maybe(optionalDate),
  deliveryCondition: maybe(optionalEnum(DELIVERY_CONDITIONS)),
  deliveryNote: maybe(optionalText(2000)),
  satEngineerId: maybe(optionalId),
  satPlannedOn: maybe(optionalDate),
  satDoneOn: maybe(optionalDate),
  satSignedBy: maybe(optionalText(120)),
});
export type DeliveryInput = z.infer<typeof deliveryInput>;

/** The whole SAT checklist, in order (like the production timeline). */
export const satInput = z.object({
  checks: z
    .array(z.object({ id: optionalId, item: text(200, "Say what is checked"), result: z.enum(SAT_RESULTS).default("pending"), note: optionalText(500) }))
    .max(80),
});
export type SatInput = z.infer<typeof satInput>;

export const claimInput = z.object({
  title: text(160, "Say what is wrong"),
  detail: optionalText(4000),
  openedOn: optionalDate,
});
export type ClaimInput = z.infer<typeof claimInput>;

export const claimUpdateInput = z.object({
  title: maybe(text(160, "Say what is wrong")),
  detail: maybe(optionalText(4000)),
  status: maybe(z.enum(CLAIM_STATUSES)),
  resolution: maybe(optionalText(4000)),
  resolvedOn: maybe(optionalDate),
});
export type ClaimUpdateInput = z.infer<typeof claimUpdateInput>;
