"use client";

import type { ComponentProps } from "react";
import { CURRENCIES, CURRENCY_LABEL } from "@kebo/shared";
import { Select } from "@kebo/ui";

/** The business's currencies (USD, CNY, PKR) as a drop-down; a value from older data that is not one of them still shows. */
export function CurrencySelect({ value, short = false, ...props }: Omit<ComponentProps<typeof Select>, "children" | "value"> & { value: string; short?: boolean }) {
  const known = (CURRENCIES as readonly string[]).includes(value);
  return (
    <Select value={value} {...props}>
      {!known && value && <option value={value}>{value}</option>}
      {CURRENCIES.map((c) => (
        <option key={c} value={c}>
          {short ? c : `${c} · ${CURRENCY_LABEL[c]}`}
        </option>
      ))}
    </Select>
  );
}
