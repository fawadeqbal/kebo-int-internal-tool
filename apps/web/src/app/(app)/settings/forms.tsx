"use client";

import { useFeature } from "@/components/common/features";
import { useState } from "react";
import { restateRates } from "@kebo/money";
import { CURRENCIES, CURRENCY_LABEL, type SettingsKey } from "@kebo/shared";
import { Card, CardBody, CardFooter, CardHeader, Checkbox, cn, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import { SETTING_GROUPS, toFormText, type SettingField } from "./groups";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** An image kept in the settings as a data URL (the company stamp): choose, preview, remove. */
function ImageControl({ f, text, error }: { f: SettingField; text: string; error?: string[] }) {
  const id = `set-${f.name}`;
  const [value, setValue] = useState(text);
  const [problem, setProblem] = useState<string | null>(null);
  const choose = (file: File | undefined) => {
    setProblem(null);
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setProblem("Choose a PNG or JPEG image.");
    if (file.size > 300 * 1024) return setProblem("This image is over 300 KB. Use a smaller scan.");
    const reader = new FileReader();
    reader.onload = () => setValue(String(reader.result));
    reader.readAsDataURL(file);
  };
  return (
    <Field label={f.label} htmlFor={id} hint={f.hint} error={problem ? [problem] : error} className={cn(f.wide && "sm:col-span-2")}>
      <div className="flex flex-wrap items-center gap-4">
        <input type="hidden" name={f.name} value={value} />
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data URL kept in the settings
          <img src={value} alt="" className="size-24 rounded-md border border-line bg-white object-contain p-1" />
        ) : (
          <div className="flex size-24 items-center justify-center rounded-md border border-dashed border-line text-xs text-muted">No stamp</div>
        )}
        <div className="flex flex-col gap-2">
          <input id={id} type="file" accept="image/png,image/jpeg,image/webp" className="text-sm" onChange={(e) => choose(e.target.files?.[0])} />
          {value && (
            <button type="button" className="self-start text-sm text-bad underline-offset-2 hover:underline" onClick={() => setValue("")}>
              Remove the stamp
            </button>
          )}
        </div>
      </div>
    </Field>
  );
}

/** A rate as typed text: 6 decimals for big rates, 10 significant digits for small ones (1 PKR = 0.003571428571 USD), so switching the main currency back and forth gives the same numbers. */
const rateText = (n: number | undefined) => (n === undefined || !Number.isFinite(n) || n <= 0 ? "" : String(n >= 1 ? Number(n.toFixed(6)) : Number(n.toPrecision(10))));

/**
 * The main currency and, for each other currency, how many of it one unit of
 * the main one buys. Choosing another main currency restates the rates
 * (1 USD = 280 PKR becomes 1 PKR = 0.003571 USD), so nothing has to be retyped.
 */
function CurrenciesControl({ f, main: initialMain, rates: initialRates, errors }: { f: SettingField; main: string; rates: Record<string, string>; errors?: string[] }) {
  const [main, setMain] = useState(initialMain);
  const [rates, setRates] = useState<Record<string, string>>(initialRates);
  const others = CURRENCIES.filter((c) => c !== main);
  const changeMain = (next: string) => {
    const numeric = Object.fromEntries(Object.entries(rates).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]));
    const restated = restateRates(numeric, main, next);
    setRates(Object.fromEntries(Object.entries(restated).map(([k, v]) => [k, rateText(v)])));
    setMain(next);
  };
  return (
    <fieldset className={cn("flex flex-col gap-3", f.wide && "sm:col-span-2")}>
      <legend className="mb-1 text-sm font-medium">{f.label}</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Main currency" htmlFor="set-currency">
          <Select id="set-currency" name="currency" value={main} onChange={(e) => changeMain(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c} · {CURRENCY_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        {others.map((c) => (
          <Field key={c} label={`1 ${main} buys`} htmlFor={`set-rate-${c}`} hint={CURRENCY_LABEL[c]}>
            <div className="flex items-center gap-2">
              <Input
                id={`set-rate-${c}`}
                name={`rate_${c}`}
                inputMode="decimal"
                className="w-32 tabular"
                value={rates[c] ?? ""}
                placeholder="Enter the rate"
                aria-invalid={!rates[c]}
                onChange={(e) => setRates((r) => ({ ...r, [c]: e.target.value }))}
              />
              <span className="text-sm font-medium text-text-2">{c}</span>
            </div>
          </Field>
        ))}
      </div>
      {f.hint && <p className="text-xs text-muted">{f.hint}</p>}
      {errors?.map((e) => (
        <p key={e} className="text-xs text-bad">
          {e}
        </p>
      ))}
    </fieldset>
  );
}

function Control({ f, text, checked, error }: { f: SettingField; text: string; checked: boolean; error?: string[] }) {
  const id = `set-${f.name}`;
  if (f.kind === "image") return <ImageControl key={text.length} f={f} text={text} error={error} />;
  if (f.kind === "bool")
    return (
      <div className={cn("flex items-start gap-2.5", f.wide && "sm:col-span-2")}>
        <Checkbox id={id} name={f.name} defaultChecked={checked} className="mt-0.5" />
        <label htmlFor={id} className="text-sm">
          <span className="font-medium">{f.label}</span>
          {f.hint && <span className="block text-xs text-muted">{f.hint}</span>}
        </label>
      </div>
    );
  const common = { id, name: f.name, defaultValue: text, "aria-invalid": !!error, placeholder: f.placeholder };
  return (
    <Field label={f.label} htmlFor={id} hint={f.hint} error={error} className={cn(f.wide && "sm:col-span-2")}>
      {f.kind === "textarea" ? (
        <Textarea {...common} rows={3} />
      ) : f.kind === "lines" ? (
        <Textarea {...common} rows={Math.min(8, Math.max(3, text.split("\n").length + 1))} className="font-mono text-[13px]" spellCheck={false} />
      ) : f.kind === "select" ? (
        // Keyed by the value: a select's default only applies when it mounts, and React resets the form after each submit.
        <Select key={text} id={id} name={f.name} defaultValue={text}>
          {f.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : f.kind === "number" ? (
        <div className="flex items-center gap-2">
          <Input {...common} type="number" inputMode="decimal" min={0} step="any" className="w-28 tabular" />
          {f.unit && <span className="text-sm text-muted">{f.unit}</span>}
        </div>
      ) : (
        <Input {...common} />
      )}
    </Field>
  );
}

/** One settings group as its own form with its own Save button. */
export function SettingsGroupForm({ groupKey, values, action }: { groupKey: SettingsKey; values: Record<string, unknown>; action: Action }) {
  const group = SETTING_GROUPS.find((g) => g.key === groupKey)!;
  // The daily summary email is part of the plan's email reports.
  const emailReports = useFeature("email_reports");
  const fields = group.fields.filter((f) => emailReports || f.name !== "dailySummary");
  return (
    <ActionForm action={action}>
      {(s) => (
        <Card id={group.key} className="scroll-mt-20">
          <CardHeader title={group.title} description={group.description} />
          <CardBody className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
            {fields.map((f) =>
              f.kind === "currencies" ? (
                <CurrenciesControl
                  key={`${f.name}-${s.values?.currency ?? values.currency}`}
                  f={f}
                  main={String(s.values?.currency ?? values.currency ?? "USD")}
                  rates={
                    s.values
                      ? Object.fromEntries(CURRENCIES.map((c) => [c, s.values?.[`rate_${c}`] ?? ""]))
                      : Object.fromEntries(Object.entries((values.exchangeRates ?? {}) as Record<string, number>).map(([k, v]) => [k, rateText(v)]))
                  }
                  errors={[...(s.errors?.currency ?? []), ...(s.errors?.exchangeRates ?? [])]}
                />
              ) : (
              <Control
                key={f.name}
                f={f}
                text={s.values ? (s.values[f.name] ?? "") : toFormText(f, values[f.name])}
                checked={s.values ? s.values[f.name] === "on" : values[f.name] === true}
                error={s.errors?.[f.name]}
              />
              ),
            )}
          </CardBody>
          <CardFooter>
            <SubmitButton pendingText="Saving…">{group.save}</SubmitButton>
          </CardFooter>
        </Card>
      )}
    </ActionForm>
  );
}
