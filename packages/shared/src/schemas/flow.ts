import { z } from "zod";
import {
  BANK_CONTRACT_STATUSES,
  CLAIM_STATUSES,
  CURRENCIES,
  FACTORY_REQUEST_STATUSES,
  ORDER_DOCUMENT_KINDS,
  ORDER_DOCUMENT_STATUSES,
  PAYMENT_ROUTES,
  SAT_RESULTS,
  SHIP_MODES,
  SHIPMENT_STATUSES,
} from "../enums";
import { REQUEST_CHANNELS } from "../workflows/flow";
import { CLAIM_BEARERS, FREIGHT_TERMS } from "../workflows/order-sections";
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

/**
 * When we placed the order with the factory (empty: not yet) and the factory's own number for it. Only the
 * fields sent change (the phone app sends the date alone).
 */
export const factoryOrderInput = z.object({ factoryOrderedOn: optionalDate.optional(), factoryOrderNo: optionalText(60).optional() });
export type FactoryOrderInput = z.infer<typeof factoryOrderInput>;

/** Send a purchase order to its supplier: the day, their order number, how, and why when the deposit is not verified yet. */
export const sendPurchaseOrderInput = z.object({
  sentOn: isoDate("When was it sent?"),
  supplierRef: optionalText(60),
  how: optionalText(40),
  reason: optionalText(300),
});
export type SendPurchaseOrderInput = z.infer<typeof sendPurchaseOrderInput>;

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
  sealNo: optionalText(40),
  /** The day the container was loaded. */
  loadedOn: optionalDate,
  /** The container's verified gross mass, kg (optional). */
  vgmKg: z.preprocess(
    (v) => (v === "" || v === null ? null : typeof v === "string" ? v.replace(/,/g, "").trim() : v),
    z.coerce.number().min(0, "Cannot be negative").max(99_999_999).nullable(),
  ),
  etd: optionalDate,
  eta: optionalDate,
  departedOn: optionalDate,
  arrivedOn: optionalDate,
  note: optionalText(2000),
  /** The forwarder's person and phone, the customs broker, the carrier's tracking number. */
  forwarderContact: optionalText(120),
  forwarderPhone: optionalText(40),
  customsBroker: optionalText(120),
  trackingNo: optionalText(80),
  /** The freight agreed with the forwarder (in its currency) and the insurance on the goods. */
  freightAmount: z.preprocess(
    (v) => (v === "" || v === null ? null : typeof v === "string" ? v.replace(/,/g, "").trim() : v),
    z.coerce.number().min(0, "Cannot be negative").max(999_999_999).nullable(),
  ),
  freightCurrency: z.preprocess((v) => (v === "" || v === null ? null : typeof v === "string" ? v.trim().toUpperCase() : v), z.string().length(3, "A currency like USD").nullable()),
  insurer: optionalText(120),
  insurancePolicyNo: optionalText(60),
  /** How the freight is paid (prepaid | collect) and what the goods are insured for (in the order's currency). */
  freightTerms: optionalEnum(FREIGHT_TERMS),
  insuredValue: z.preprocess(
    (v) => (v === "" || v === null ? null : typeof v === "string" ? v.replace(/,/g, "").trim() : v),
    z.coerce.number().min(0, "Cannot be negative").max(999_999_999_999).nullable(),
  ),
  /** Customs at the destination. */
  customsDeclarationNo: optionalText(60),
  clearedOn: optionalDate,
};
/**
 * A save that looks out of order (delivered before it arrived, sailing after the ship-by date) asks first:
 * `ask` says the screen can ask (the API answers 409 "confirm" with what it saw), `confirm` goes ahead, with why.
 */
const goAhead = { ask: z.boolean().optional(), confirm: z.boolean().optional(), reason: z.string().trim().max(500).optional() };

const etaAfterEtd = (v: { etd?: string | null; eta?: string | null }) => !v.etd || !v.eta || v.eta >= v.etd;
const etaMessage = { message: "The arrival date (ETA) cannot be before the departure date (ETD)", path: ["eta"] };

export const shipmentInput = z
  .object({
    ...shipmentFields,
    mode: shipmentFields.mode.default("sea"),
    status: shipmentFields.status.default("planned"),
    vgmKg: shipmentFields.vgmKg.optional().transform((v) => v ?? null),
    ...Object.fromEntries(
      (["forwarderContact", "forwarderPhone", "customsBroker", "trackingNo", "freightAmount", "freightCurrency", "insurer", "insurancePolicyNo", "freightTerms", "insuredValue", "customsDeclarationNo", "clearedOn"] as const).map((k) => [
        k,
        shipmentFields[k].optional(),
      ]),
    ),
    /** Not sent: from the order's terms (portsOf: E/F terms load at the Incoterm place, C/D terms discharge there). Empty: none. */
    portOfLoading: shipmentFields.portOfLoading.optional(),
    portOfDischarge: shipmentFields.portOfDischarge.optional(),
    ...goAhead,
  })
  .refine(etaAfterEtd, etaMessage);
export type ShipmentInput = z.infer<typeof shipmentInput>;

export const shipmentUpdateInput = z
  .object({
    ...(Object.fromEntries(Object.entries(shipmentFields).map(([k, v]) => [k, v.optional()])) as { [K in keyof typeof shipmentFields]: z.ZodOptional<(typeof shipmentFields)[K]> }),
    ...goAhead,
  })
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
  /** Kept elsewhere: where it is (a shelf, a person, a bank, an email). */
  keptWhere: optionalText(200),
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
  // No condition here: it is worked out from the goods lines (deliveryConditionOf); "All delivered OK"
  // (POST …/delivery/all-good) marks every line good.
  deliveryNote: maybe(optionalText(2000)),
  /** Who received the goods at the customer's. */
  deliveryReceivedBy: maybe(optionalText(120)),
  satEngineerId: maybe(optionalId),
  satPlannedOn: maybe(optionalDate),
  satDoneOn: maybe(optionalDate),
  satSignedBy: maybe(optionalText(120)),
  /** The day the machine was installed, and the warranty in months (counted from the SAT, else the delivery). */
  installedOn: maybe(optionalDate),
  warrantyMonths: maybe(
    z.preprocess((v) => (v === "" || v === null ? null : v), z.coerce.number().int("Whole months").min(0).max(240).nullable()),
  ),
  ...goAhead,
});
export type DeliveryInput = z.infer<typeof deliveryInput>;

/** Every SAT point, in order. */
export const satInput = z.object({
  checks: z
    .array(z.object({ id: optionalId, item: text(200, "Say what is checked"), result: z.enum(SAT_RESULTS).default("pending"), note: optionalText(500) }))
    .max(80),
});
export type SatInput = z.infer<typeof satInput>;

/** One tap on Delivery & SAT: every goods line delivered in full and in good condition, on this day (empty: today). */
export const deliveryAllGoodInput = z.object({ deliveredOn: optionalDate.optional() });
export type DeliveryAllGoodInput = z.infer<typeof deliveryAllGoodInput>;

/** One tap on the SAT: every open point passed, signed off on this day (empty: today) by this person. */
export const satAllPassedInput = z.object({ satDoneOn: optionalDate.optional(), satSignedBy: optionalText(120).optional() });
export type SatAllPassedInput = z.infer<typeof satAllPassedInput>;

/** What a claim is worth (in the order's currency) and who bears it: the factory, us or the customer. */
const claimMoney = { amount: maybe(optionalAmount), bearer: maybe(optionalEnum(CLAIM_BEARERS)) };

export const claimInput = z.object({
  title: text(160, "Say what is wrong"),
  detail: optionalText(4000),
  openedOn: optionalDate,
  ...claimMoney,
});
export type ClaimInput = z.infer<typeof claimInput>;

export const claimUpdateInput = z.object({
  title: maybe(text(160, "Say what is wrong")),
  detail: maybe(optionalText(4000)),
  status: maybe(z.enum(CLAIM_STATUSES)),
  resolution: maybe(optionalText(4000)),
  resolvedOn: maybe(optionalDate),
  ...claimMoney,
});
export type ClaimUpdateInput = z.infer<typeof claimUpdateInput>;
