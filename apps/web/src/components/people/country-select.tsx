"use client";

import { UNKNOWN_COUNTRY } from "@kebo/shared";
import { COUNTRIES, countryName } from "@/lib/countries";
import { TypeToPick } from "@/components/common/type-to-pick";

/**
 * A country: type to find it in the list (the one list chooser, TypeToPick), plus "Not known yet" (ZZ). A stored
 * code that is not in the list stays a choice. The code goes in the form under `name`.
 */
export function CountrySelect({
  id,
  name,
  value,
  onChange,
  invalid,
}: {
  id: string;
  name?: string;
  value: string;
  onChange: (code: string) => void;
  invalid?: boolean;
}) {
  const known = !value || value === UNKNOWN_COUNTRY || COUNTRIES.some(([c]) => c === value);
  const options = [
    { value: UNKNOWN_COUNTRY, label: "Not known yet" },
    ...(known ? [] : [{ value, label: countryName(value) }]),
    ...COUNTRIES.map(([code, label]) => ({ value: code, label })),
  ];
  return <TypeToPick id={id} name={name} value={value} onChange={onChange} options={options} listLabel="Countries" invalid={invalid} />;
}
