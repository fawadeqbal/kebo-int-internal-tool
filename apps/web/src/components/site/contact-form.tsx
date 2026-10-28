"use client";

import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";
import type { LeadOrigin } from "@kebo/shared";
import type { ActionState } from "@/lib/actions";
import { OriginFields } from "./origin-fields";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

const field =
  "mt-1 block w-full rounded-md border border-(--s-line) bg-white px-3 py-2 text-[0.95rem] text-(--s-ink) placeholder:text-(--s-steel)/70 focus:border-(--s-violet)";

/** "Ask a question" on the marketing page: reaches the platform admin as a lead. */
export function ContactForm({ action, origin, disabled = false }: { action: Action; origin: LeadOrigin | null; disabled?: boolean }) {
  const [state, send, pending] = useActionState(action, {});
  if (state.ok)
    return (
      <div className="flex flex-col items-start gap-3 py-6" role="status">
        <CheckCircle2 className="size-8 text-(--s-violet)" aria-hidden />
        <p className="text-[0.95rem]">{state.message}</p>
      </div>
    );
  const v = state.values ?? {};
  const err = (k: string) =>
    state.errors?.[k]?.[0] ? (
      <span className="mt-1 block text-sm text-(--s-seal)" id={`c-${k}-error`}>
        {state.errors[k]![0]}
      </span>
    ) : null;
  return (
    <form action={send} className="flex flex-col gap-4" noValidate>
      {state.message && (
        <p role="alert" className="rounded-md bg-[#fdecef] px-3 py-2 text-sm text-(--s-seal)">
          {state.message}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">
          Your name
          <input
            name="name"
            autoComplete="name"
            required
            defaultValue={v.name}
            className={field}
            aria-invalid={!!state.errors?.name}
            aria-describedby="c-name-error"
          />
          {err("name")}
        </label>
        <label className="text-sm font-medium">
          Email
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={v.email}
            className={field}
            aria-invalid={!!state.errors?.email}
            aria-describedby="c-email-error"
          />
          {err("email")}
        </label>
        <label className="text-sm font-medium">
          Company <span className="font-normal text-(--s-steel)">(optional)</span>
          <input name="companyName" autoComplete="organization" defaultValue={v.companyName} className={field} />
        </label>
        <label className="text-sm font-medium">
          Phone or WhatsApp <span className="font-normal text-(--s-steel)">(optional)</span>
          <input name="phone" type="tel" autoComplete="tel" defaultValue={v.phone} className={field} />
        </label>
      </div>
      <label className="text-sm font-medium">
        Your question
        <textarea
          name="message"
          rows={4}
          required
          defaultValue={v.message}
          className={field}
          aria-invalid={!!state.errors?.message}
          aria-describedby="c-message-error"
        />
        {err("message")}
      </label>
      {/* People never see or fill this; bots do. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
      <OriginFields origin={{ ...origin, cta: "question" }} />
      <div>
        <button
          type="submit"
          disabled={disabled || pending}
          className="rounded-md bg-(--s-violet) px-5 py-2.5 font-semibold text-white hover:bg-(--s-violet-deep) disabled:opacity-60"
        >
          {pending ? "Sending…" : "Send the question"}
        </button>
        {disabled && <span className="ml-3 text-sm text-(--s-steel)">The form works on the live page.</span>}
      </div>
    </form>
  );
}
