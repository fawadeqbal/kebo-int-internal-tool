import { z } from "zod";
import { PAYMENT_ROUTES } from "../enums";
import { FLOW_STEPS } from "../workflows/flow";
import { CHECKLIST_FIELD_TYPES, CHECKLIST_TOOLS, HIDEABLE_AUTO_KEYS } from "../workflows/checklist";
import { optionalDate, optionalId, optionalText, text } from "./common";

/** Inputs for an order's checklist and the company's list (see workflows/checklist). */

const maybe = <T extends z.ZodTypeAny>(s: T) => s.optional();
const optionalRoute = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.enum(PAYMENT_ROUTES).nullable());

export const checklistField = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/, "Use letters and numbers for the field's key"),
  label: text(60, "Name the field"),
  type: z.enum(CHECKLIST_FIELD_TYPES).default("text"),
});

const fields = z
  .array(checklistField)
  .max(8, "At most 8 fields")
  .refine((list) => new Set(list.map((f) => f.key)).size === list.length, "Two fields have the same name")
  .default([]);

/** An item added on the order (or changed: only the fields sent change). */
export const checklistItemInput = z.object({
  step: z.enum(FLOW_STEPS),
  title: text(200, "Say what has to be done"),
  tool: z.enum(CHECKLIST_TOOLS).default("done"),
  fields,
  route: optionalRoute.optional().transform((v) => v ?? null),
  dueOn: optionalDate,
  assigneeId: optionalId,
  note: optionalText(1000),
});
export type ChecklistItemInput = z.infer<typeof checklistItemInput>;

export const checklistItemUpdateInput = z.object({
  title: maybe(text(200, "Say what has to be done")),
  tool: maybe(z.enum(CHECKLIST_TOOLS)),
  fields: maybe(fields),
  route: maybe(optionalRoute),
  dueOn: maybe(optionalDate),
  assigneeId: maybe(optionalId),
  note: maybe(optionalText(1000)),
  /** The values the item collected (Change the details). */
  data: maybe(z.record(z.string().max(40), z.string().trim().max(500))),
  attachmentId: maybe(optionalId),
});
export type ChecklistItemUpdateInput = z.infer<typeof checklistItemUpdateInput>;

/** Tick an item, with what its form collected and the file attached. */
export const checklistTickInput = z.object({
  data: z.record(z.string().max(40), z.string().trim().max(500)).default({}),
  attachmentId: optionalId,
});
export type ChecklistTickInput = z.infer<typeof checklistTickInput>;

export const checklistSkipInput = z.object({ reason: text(300, "Say why it is skipped") });
export type ChecklistSkipInput = z.infer<typeof checklistSkipInput>;

/** An automatic item's overrides: due date, person, note, skipped with a reason (skipped: false un-skips). */
export const checklistAutoInput = z
  .object({
    dueOn: maybe(optionalDate),
    assigneeId: maybe(optionalId),
    note: maybe(optionalText(1000)),
    skipped: maybe(z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean())),
    skipReason: maybe(optionalText(300)),
  })
  .refine((v) => v.skipped !== true || !!v.skipReason, { message: "Say why it is skipped", path: ["skipReason"] });
export type ChecklistAutoInput = z.infer<typeof checklistAutoInput>;

/** The company's whole list at once, and the automatic items it hides. */
export const checklistTemplateInput = z.object({
  items: z
    .array(
      z.object({
        step: z.enum(FLOW_STEPS),
        title: text(200, "Say what has to be done"),
        tool: z.enum(CHECKLIST_TOOLS).default("done"),
        fields,
        route: optionalRoute.optional().transform((v) => v ?? null),
        dueDays: z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().int().min(0).max(3650).nullable()),
      }),
    )
    .max(200),
  hidden: z.array(z.enum(HIDEABLE_AUTO_KEYS as [string, ...string[]])).max(60).default([]),
});
export type ChecklistTemplateInput = z.infer<typeof checklistTemplateInput>;
