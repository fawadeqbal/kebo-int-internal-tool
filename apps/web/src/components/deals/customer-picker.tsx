"use client";

import { Building2 } from "lucide-react";
import { Picker } from "@/components/common/picker";
import { countryName } from "@/lib/countries";
import type { CustomerOption } from "@/lib/types-deals";

const countryText = (c: string) => (c === "ZZ" ? "Country not set" : countryName(c));

/**
 * The customer picker (design rules 18 Nov): one search box. Before anything is typed it lists the recent
 * customers; while typing, the results — each with its main contact and country. "+ New customer" is the last
 * choice, with what was typed carried over. Keyboard: ↑ ↓ Enter, Escape.
 */
export function CustomerPicker({
  value,
  onChange,
  search,
  recent,
  onNew,
  newLabel = "New customer",
  error,
  disabled,
  disabledReason,
}: {
  value: CustomerOption | null;
  onChange: (c: CustomerOption | null) => void;
  search: (q: string) => Promise<CustomerOption[]>;
  /** The recent customers, shown before anything is typed. */
  recent?: () => Promise<CustomerOption[]>;
  /** "+ New customer": called with what was typed. */
  onNew?: (typed: string) => void;
  newLabel?: string;
  error?: string[];
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <Picker<CustomerOption>
      inputId="customer"
      placeholder="Search customers"
      listLabel="Customers"
      icon={<Building2 />}
      chosen={
        value && {
          name: value.name,
          sub: `${countryText(value.country)}${value.primaryContact ? ` · ${value.primaryContact.name} (main contact)` : ""}`,
        }
      }
      onClear={() => onChange(null)}
      onPick={onChange}
      search={search}
      recent={recent}
      line={(c) => ({
        sub: c.primaryContact ? [c.primaryContact.name, c.primaryContact.detail].filter(Boolean).join(" · ") : "No contact",
        end: countryText(c.country),
        endTone: c.country === "ZZ" ? "warn" : undefined,
      })}
      newLabel={newLabel}
      onNew={onNew}
      empty={(typed) => (typed ? `No customer matches “${typed}”` : "No customers yet")}
      error={error}
      disabled={disabled}
      disabledReason={disabledReason}
    />
  );
}
