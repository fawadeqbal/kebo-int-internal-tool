import { Filter } from "lucide-react";
import { Button, SearchField, Select } from "@kebo/ui";

export interface FilterSelect {
  /** The URL parameter. */
  name: string;
  /** "Country" → "Country: All". */
  label: string;
  value?: string;
  options: { value: string; label: string }[];
}

/**
 * The board's filter strip (white card): a search that takes the width, the list's selects ("Country: All"),
 * and Filter. One GET form, so every choice is in the URL; `keep` carries the chips' own parameters.
 */
export function FilterCard({
  search,
  value,
  selects = [],
  keep = {},
  clearHref,
}: {
  search: string;
  value?: string;
  selects?: FilterSelect[];
  keep?: Record<string, string | undefined>;
  clearHref?: string;
}) {
  return (
    <form
      role="search"
      aria-label="Filter the list"
      className="mb-4 flex flex-wrap items-center gap-2.5 rounded-[14px] border border-line bg-surface p-3"
    >
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <SearchField
        defaultValue={value}
        placeholder={search}
        label={search.replace(/…$/, "")}
        clearHref={value ? clearHref : undefined}
        className="min-w-0 flex-[1_1_260px] sm:w-auto"
      />
      {selects.map((s) => (
        <span key={s.name} className="max-sm:flex-1">
          <label htmlFor={`filter-${s.name}`} className="sr-only">
            {s.label}
          </label>
          <Select id={`filter-${s.name}`} name={s.name} defaultValue={s.value ?? ""} className="w-full text-[13px] sm:w-auto">
            <option value="">{s.label}: All</option>
            {s.options.map((o) => (
              <option key={o.value} value={o.value}>
                {s.label}: {o.label}
              </option>
            ))}
          </Select>
        </span>
      ))}
      <Button type="submit">
        <Filter aria-hidden />
        Filter
      </Button>
    </form>
  );
}
