"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircleQuestion } from "lucide-react";
import { Input } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import type { ActionState } from "@/lib/actions";

/**
 * Shown inside a form when the API answers code "reason_needed": the change
 * reaches someone else (the customer, a factory, money), so it asks why. A
 * quick choice or the person's own words goes back with the same form as
 * `reason`, and is kept in the record's history.
 */
export function ReasonPrompt({ state }: { state: ActionState }) {
  const [value, setValue] = useState(state.values?.reason ?? "");
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    input.current?.focus({ preventScroll: true });
  }, [state]);
  return (
    <div
      ref={box}
      role="alert"
      className="mb-3 flex w-full min-w-0 flex-col gap-2 rounded-lg border border-info/30 bg-info-soft p-3 text-sm"
    >
      <div className="flex items-start gap-2">
        <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <div>
          <span className="block font-medium">Why?</span>
          <span className="text-text-2">{state.message} It is kept in the history.</span>
        </div>
      </div>
      {!!state.choices?.length && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick reasons">
          {state.choices.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={value === c}
              onClick={() => {
                setValue(c);
                input.current?.focus();
              }}
              className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs hover:border-line-strong aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:text-primary"
            >
              {c}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          ref={input}
          name="reason"
          aria-label="Reason"
          maxLength={500}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Choose above or write the reason"
          className="min-w-0 flex-1 basis-56"
        />
        {/* A warning the person already went ahead with stays accepted. */}
        {state.values?.confirm === "true" && <input type="hidden" name="confirm" value="true" />}
        <SubmitButton size="sm" pendingText="Saving…" disabled={!value.trim()}>
          Save with this reason
        </SubmitButton>
      </div>
    </div>
  );
}
