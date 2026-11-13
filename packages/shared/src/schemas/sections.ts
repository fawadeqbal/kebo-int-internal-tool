import { z } from "zod";
import { REQUEST_CHANNELS } from "../workflows/flow";
import { FAT_RESULTS } from "../workflows/order-sections";
import { optionalDate, optionalId, optionalText } from "./common";

/**
 * Inputs for the order's sections (see workflows/order-sections). A change sends only the fields its
 * window has; an empty field clears it.
 */

const maybe = <T extends z.ZodTypeAny>(s: T) => s.optional();
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) => z.preprocess((v) => (v === "" ? null : v), z.enum(values).nullable());

/**
 * Production, for one factory of the order (factoryId empty: the goods of an order whose lines name no
 * factory): when and how the ready date was told, the factory test, where the goods were received.
 * The ready date itself is the order's (PATCH /orders/:id/details).
 */
export const factoryFactsInput = z
  .object({
    factoryId: optionalId,
    readyToldOn: maybe(optionalDate),
    readyToldVia: maybe(optionalEnum(REQUEST_CHANNELS)),
    readyNote: maybe(optionalText(500)),
    fatPlannedOn: maybe(optionalDate),
    fatAttendedById: maybe(optionalId),
    fatDoneOn: maybe(optionalDate),
    fatResult: maybe(optionalEnum(FAT_RESULTS)),
    fatRemarks: maybe(optionalText(1000)),
    goodsReceivedAt: maybe(optionalText(160)),
  })
  .refine((v) => !v.fatResult || !!v.fatDoneOn || v.fatDoneOn === undefined, { message: "Say the day the test was done", path: ["fatDoneOn"] });
export type FactoryFactsInput = z.infer<typeof factoryFactsInput>;
