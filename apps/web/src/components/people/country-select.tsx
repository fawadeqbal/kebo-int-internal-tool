import type { ComponentProps } from "react";
import { UNKNOWN_COUNTRY } from "@kebo/shared";
import { Select } from "@kebo/ui";
import { COUNTRIES, countryName } from "@/lib/countries";

/** Every country in the list, plus "Not known yet" (ZZ). A stored code that is not in the list stays selectable. */
export function CountrySelect({ value, ...props }: Omit<ComponentProps<typeof Select>, "children"> & { value?: string }) {
  const known = !value || value === UNKNOWN_COUNTRY || COUNTRIES.some(([c]) => c === value);
  return (
    <Select value={value} {...props}>
      <option value={UNKNOWN_COUNTRY}>ZZ — Not known yet</option>
      {!known && <option value={value}>{countryName(value)}</option>}
      {COUNTRIES.map(([code, name]) => (
        <option key={code} value={code}>
          {name} ({code})
        </option>
      ))}
    </Select>
  );
}
