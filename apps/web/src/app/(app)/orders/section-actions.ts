"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, formValues, reasonOf, type ActionState } from "@/lib/actions";
import type { OrderView } from "@/lib/types-orders";
import { paymentAction } from "./actions";

/**
 * What the windows of an order's sections send (the order without checklists) where no action existed:
 * Production's ready date with when and how it was told, the factory test, and the goods received.
 * Each goes to the endpoints the rest of the app uses; a field a window does not have is not changed.
 */

const refresh = (orderId: string) => {
  revalidatePath(`/orders/${orderId}`, "layout");
  revalidatePath("/orders");
};

const pick = (v: Record<string, string>, keys: string[]) => Object.fromEntries(keys.filter((k) => k in v).map((k) => [k, v[k]]));
const ahead = (v: Record<string, string>) => ({
  ...(v.ask === "true" ? { ask: true } : {}),
  ...(v.confirm === "true" ? { confirm: true, reason: v.reason?.trim() || undefined } : {}),
});

/** "Ready date": the date itself is the order's (its plans follow it); told on, how and the note are kept with the factory. */
export async function readyDateAction(orderId: string, factoryId: string | null, was: string | null, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    async () => {
      // The date only when it changed: the order's plans are built again from it.
      if ("readyOn" in v && (v.readyOn || null) !== was)
        await api.patch(`/orders/${orderId}/details`, {
          ...(factoryId ? { readyBy: [{ factoryId, readyOn: v.readyOn || null }] } : { readyOn: v.readyOn || null }),
          reason: reasonOf(form),
          ...ahead(v),
        });
      const facts = pick(v, ["readyToldOn", "readyToldVia", "readyNote"]);
      if (Object.keys(facts).length) await api.put(`/orders/${orderId}/factory-facts`, { factoryId, ...facts });
      return null;
    },
    "Saved.",
  );
  if (r.ok) refresh(orderId);
  return r;
}

/** "Factory test (FAT)": planned, who attends, done, how it went. */
export async function factoryTestAction(orderId: string, factoryId: string | null, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    () => api.put(`/orders/${orderId}/factory-facts`, { factoryId, ...pick(v, ["fatPlannedOn", "fatAttendedById", "fatDoneOn", "fatResult", "fatRemarks"]) }),
    "Saved.",
  );
  if (r.ok) refresh(orderId);
  return r;
}

/**
 * "All received": every goods line in full on the day given, and where they were received. With the
 * lines already in, only the place is kept.
 */
export async function goodsReceivedAction(orderId: string, factoryId: string | null, all: boolean, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    async () => {
      if (all) {
        const o = await api.get<OrderView>(`/orders/${orderId}`);
        const lines = o.lines.filter((l) => l.type === "goods").map((l) => ({ lineId: l.id, receivedQty: Number(l.quantity) }));
        await api.put(`/orders/${orderId}/receipt`, { on: v.receivedOn || null, lines });
      }
      if ("goodsReceivedAt" in v) await api.put(`/orders/${orderId}/factory-facts`, { factoryId, goodsReceivedAt: v.goodsReceivedAt });
      return null;
    },
    all ? "All goods marked as received." : "Saved.",
  );
  if (r.ok) refresh(orderId);
  return r;
}

/**
 * "Bank paid us" on Documents (bank contract and LC): the payment itself, recorded with the same form as
 * on Payment; recording it marks the bank's last step.
 */
export async function bankPaidAction(orderId: string, currency: string, prev: ActionState, form: FormData): Promise<ActionState> {
  form.set("bankStep", "bank_paid_us");
  return paymentAction(orderId, currency, prev, form);
}
