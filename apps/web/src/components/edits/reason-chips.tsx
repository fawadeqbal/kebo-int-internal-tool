"use client";

import { useState, type ReactNode } from "react";
import { Button, buttonClass, Input, cn } from "@kebo/ui";
import { ChoiceChips } from "@/components/common/choice-chips";
import { BottomSheet } from "@/components/common/bottom-sheet";

const OTHER = "Other…";

/**
 * "Why the change?" (design rules 18 Nov): shown only when something changed, a few quick choices for that kind
 * of change and Other… for one's own words. The save waits until there is an answer.
 */
export function ReasonChips({
  choices,
  value,
  onChange,
  title = "Why the change?",
  strip = false,
  bare = false,
}: {
  choices: readonly string[];
  value: string;
  onChange: (reason: string) => void;
  title?: string;
  /** A strip right above Save, across the window (under a long list, design 18 Nov), in place of a box. */
  strip?: boolean;
  /** Only the choices (in ReasonSheet, whose title asks the question). */
  bare?: boolean;
}) {
  const known = choices.includes(value);
  const [other, setOther] = useState(!!value && !known);
  const options = [...choices, OTHER];
  return (
    <section
      aria-label={title}
      className={cn(
        "flex gap-2.5",
        bare
          ? "flex-col"
          : strip
            ? "shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-action/25 bg-action-soft/60 px-6 py-3 max-md:flex-col max-md:items-stretch max-md:px-4"
            : "flex-col rounded-xl border border-action/25 bg-action-soft/60 px-4 py-3",
      )}
    >
      {!bare && (
        <p className="text-sm font-bold whitespace-nowrap">
          {title} <span className="text-bad" aria-hidden>*</span>
        </p>
      )}
      <ChoiceChips
        label={title}
        value={other ? OTHER : known ? value : ""}
        options={options}
        onChange={(c) => {
          if (c === OTHER) {
            setOther(true);
            onChange("");
          } else {
            setOther(false);
            onChange(c);
          }
        }}
      />
      {other && (
        <Input
          aria-label="Why, in your words"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={500}
          autoFocus
          className={strip ? "basis-full" : undefined}
        />
      )}
    </section>
  );
}

/**
 * "Why the change?" asked once, when Save is pressed (canvas board "Why the change? at Save", approved 19 Nov): never
 * shown while editing. A sheet over the window (a card on a laptop) says what changed, the quick reasons and Other…,
 * then Cancel · Save; Save sends the window's form (`formId`) with the reason. Cancel goes back to the window, nothing
 * lost.
 */
export function ReasonSheet({
  open,
  onClose,
  choices,
  value,
  onChange,
  formId,
  title = "Why the change?",
  what,
  saveLabel,
}: {
  open: boolean;
  onClose: () => void;
  choices: readonly string[];
  value: string;
  onChange: (reason: string) => void;
  /** The form Save sends. */
  formId: string;
  title?: string;
  /** What changed, in a line ("1 change: Item 2.1 · price — → 1,500.00"). */
  what?: ReactNode;
  saveLabel: ReactNode;
}) {
  if (!open) return null;
  return (
    <BottomSheet
      title={title}
      sub={what}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <button type="submit" form={formId} disabled={!value.trim()} className={buttonClass("primary", "md")}>
            {saveLabel}
          </button>
        </>
      }
    >
      <div className="px-4 py-3">
        <ReasonChips bare choices={choices} value={value} onChange={onChange} title={title} />
      </div>
    </BottomSheet>
  );
}
