"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { ShareVia } from "@kebo/shared";
import { api, SESSION_COOKIE } from "@/lib/api";
import { attempt, formValues, type ActionState } from "@/lib/actions";
import { sendRequestAction } from "./money/actions";

/**
 * Email and Share (design "Email and Share", 26 Nov 2026): the server side of the two buttons. Email from the app
 * goes from the company's one address with what goes attached, fetched here with the person's own session (the
 * PDF as shown from /pdf/…, a stored file from /files/…: who may not see it gets nothing); sent by the person
 * (their mail app, WhatsApp, in person…) is only noted. An order's is noted in its History.
 */

/** One thing that goes, as the window passes it: its name, where it is fetched, and what it is of the order. */
export type Going = { key: string; name: string; download: string; paper?: string | null; file?: string | null };
/** What it belongs to: an order (its History), else what the activity log puts it under. */
export type SendOn = { order?: string | null; about?: string | null };

const list = (s: string | undefined) => (s ?? "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
/** Only our own PDFs and stored files are fetched: never an address from the browser. */
const OWN = /^\/(pdf|files)\/[\w-]+(\/[\w-]+)?(\?[\w=&%.,:+-]*)?$/;
const origin = () => (process.env.PDF_ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`).replace(/\/$/, "");

/** What of `going` the form ticked (`include`): the first always goes. */
function chosenOf(going: Going[], form: FormData) {
  const keys = new Set(form.getAll("include").map(String));
  return going.filter((g, i) => i === 0 || keys.has(g.key));
}

/** Email from the app: the ticked ones attached, to, copy, subject and message; noted where it belongs. */
export async function emailOutAction(on: SendOn, going: Going[], _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const to = list(v.to);
  if (!to.length) return { ok: false, message: "Who is it to?", errors: { to: ["Write their email"] }, values: v };
  const chosen = chosenOf(going, form);
  if (!chosen.length || chosen.length > 12) return { ok: false, message: "Choose up to 12 to send.", values: v };
  if (chosen.some((g) => !OWN.test(g.download))) return { ok: false, message: "One of these cannot be attached.", values: v };
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return { ok: false, message: "Your session ended. Please sign in again.", values: v };
  const body = new FormData();
  body.set("to", to.join(", "));
  body.set("cc", list(v.cc).join(", "));
  body.set("subject", v.subject ?? "");
  body.set("message", v.message ?? "");
  body.set("names", JSON.stringify(chosen.map((g) => g.name)));
  if (on.order) {
    body.set("order", on.order);
    body.set("papers", chosen.flatMap((g) => (g.paper ? [g.paper] : [])).join(","));
    body.set("files", chosen.flatMap((g) => (g.file ? [g.file] : [])).join(","));
  } else if (on.about) body.set("about", on.about);
  for (const g of chosen) {
    const res = await fetch(`${origin()}${g.download}`, { headers: { cookie: `${SESSION_COOKIE}=${session}` }, cache: "no-store" });
    if (!res.ok) return { ok: false, message: `${g.name} could not be made: ${(await res.text()).slice(0, 200) || res.status}`, values: v };
    body.append("files", new Blob([await res.arrayBuffer()], { type: res.headers.get("content-type") ?? "application/octet-stream" }), "file");
  }
  const r = await attempt(form, () => api.upload(`/mail/send`, body));
  if (!r.ok) return r;
  if (on.order) revalidatePath(`/orders/${on.order}`, "layout");
  return { ok: true, message: `Emailed to ${to.join(", ")}`, detail: chosen.map((g) => g.name).join(", ") };
}

/** Sent by the person (their mail app, WhatsApp, in person…): noted in the order's History with how and when. */
export async function noteSentAction(on: SendOn, going: Going[], _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const via = (v.via ?? "other") as ShareVia;
  const chosen = chosenOf(going, form);
  if (!on.order) return { ok: true, message: "Done." };
  const r = await attempt(form, () =>
    api.post(`/orders/${on.order}/files/share`, {
      papers: chosen.flatMap((g) => (g.paper ? [g.paper] : [])),
      files: chosen.flatMap((g) => (g.file ? [g.file] : [])),
      via,
      on: v.on || null,
      message: v.message || null,
    }),
  );
  if (!r.ok) return r;
  revalidatePath(`/orders/${on.order}`, "layout");
  return { ok: true, message: "Noted as sent", detail: chosen.map((g) => g.name).join(", ") };
}

/** Shared from a chat app (Share): noted like any send by the person. */
export async function noteSharedAction(on: SendOn, going: Going[], via: ShareVia): Promise<ActionState> {
  const form = new FormData();
  form.set("via", via);
  for (const g of going) form.append("include", g.key);
  return noteSentAction(on, going, {}, form);
}

/**
 * A payment request (Send request): kept exactly as it prints now first (sent again: the API asks why), then
 * emailed from the app as kept. Sent by the person, Send request's own action keeps it.
 */
export async function emailRequestAction(orderId: string, ref: string, going: Going[], prev: ActionState, form: FormData): Promise<ActionState> {
  const kept = await sendRequestAction(orderId, ref, prev, form);
  if (!kept.ok) return kept;
  const sent = await emailOutAction({ order: orderId }, going, prev, form);
  if (!sent.ok) return { ...sent, message: `${kept.message ?? "The request is kept as sent"}, but the email did not go: ${sent.message}` };
  return { ok: true, message: `${kept.message ?? "Payment request sent"} by email`, detail: kept.detail };
}
