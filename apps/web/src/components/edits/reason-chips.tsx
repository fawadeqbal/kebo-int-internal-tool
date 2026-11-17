"use client";

import { useState } from "react";
import { Input, cn } from "@kebo/ui";
import { ChoiceChips } from "@/components/common/choice-chips";

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
}: {
  choices: readonly string[];
  value: string;
  onChange: (reason: string) => void;
  title?: string;
  /** A strip right above Save, across the window (under a long list, design 18 Nov), in place of a box. */
  strip?: boolean;
}) {
  const known = choices.includes(value);
  const [other, setOther] = useState(!!value && !known);
  const options = [...choices, OTHER];
  return (
    <section
      aria-label={title}
      className={cn(
        "flex gap-2.5 bg-action-soft/60",
        strip
          ? "shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-action/25 px-6 py-3 max-md:flex-col max-md:items-stretch max-md:px-4"
          : "flex-col rounded-xl border border-action/25 px-4 py-3",
      )}
    >
      <p className="text-sm font-bold whitespace-nowrap">
        {title} <span className="text-bad" aria-hidden>*</span>
      </p>
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
