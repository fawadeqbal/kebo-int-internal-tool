"use client";

import { useRef } from "react";
import { Button, Input, Select } from "@/components/ui";
import { PRESETS } from "@/modules/reports/range";

/** Picking a date switches the period to "Custom"; picking a preset applies straight away. */
export function ReportFilters({
  preset,
  from,
  to,
  staffId,
  people,
}: {
  preset: string;
  from: string;
  to: string;
  staffId?: string;
  people: { id: string; name: string }[];
}) {
  const form = useRef<HTMLFormElement>(null);
  const presetRef = useRef<HTMLSelectElement>(null);
  return (
    <form ref={form} className="flex flex-wrap items-end gap-3 p-4">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Period
        <Select ref={presetRef} name="range" defaultValue={preset} className="w-44" onChange={(e) => e.target.value !== "custom" && form.current?.requestSubmit()}>
          {Object.entries(PRESETS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        From
        <Input type="date" name="from" defaultValue={from} className="w-40" onChange={() => presetRef.current && (presetRef.current.value = "custom")} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        To
        <Input type="date" name="to" defaultValue={to} className="w-40" onChange={() => presetRef.current && (presetRef.current.value = "custom")} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Staff
        <Select name="staff" defaultValue={staffId ?? ""} className="w-48" onChange={() => form.current?.requestSubmit()}>
          <option value="">Everyone</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </label>
      <Button variant="secondary">Apply</Button>
    </form>
  );
}
