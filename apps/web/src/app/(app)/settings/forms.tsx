"use client";

import { useFeature } from "@/components/common/features";
import { useEffect, useRef, useState } from "react";
import { restateRates } from "@kebo/money";
import { brandMarkOf, CURRENCIES, CURRENCY_LABEL, type SettingsKey } from "@kebo/shared";
import { Card, CardBody, CardFooter, CardHeader, Checkbox, cn, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import { SETTING_GROUPS, toFormText, type SettingField } from "./groups";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** A picture made at most `max` pixels wide and high (keeps its shape), as a PNG data URL. */
function shrink(dataUrl: string, max: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      if (scale === 1) return resolve(dataUrl);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/** An image kept in the settings as a data URL (the logo, the stamp): choose, preview, remove. */
function ImageControl({ f, text, error }: { f: SettingField; text: string; error?: string[] }) {
  const id = `set-${f.name}`;
  const noun = f.noun ?? "image";
  const [value, setValue] = useState(text);
  const [problem, setProblem] = useState<string | null>(null);
  const hidden = useRef<HTMLInputElement>(null);
  // Let the form know (the header preview follows it).
  useEffect(() => {
    hidden.current?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [value]);
  const choose = (file: File | undefined) => {
    setProblem(null);
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setProblem("Choose a PNG or JPEG image.");
    if (file.size > (f.maxPixels ? 5 * 1024 : 300) * 1024) return setProblem(`This image is over ${f.maxPixels ? "5 MB" : "300 KB"}. Use a smaller one.`);
    const reader = new FileReader();
    reader.onload = async () => {
      const url = f.maxPixels ? await shrink(String(reader.result), f.maxPixels) : String(reader.result);
      if (url.length > 400_000) return setProblem("This image is still too large after making it smaller. Use a simpler one.");
      setValue(url);
    };
    reader.readAsDataURL(file);
  };
  return (
    <Field label={f.label} htmlFor={id} hint={f.hint} error={problem ? [problem] : error} className={cn(f.wide && "sm:col-span-2")}>
      <div className="flex flex-wrap items-center gap-4">
        <input ref={hidden} type="hidden" name={f.name} value={value} />
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data URL kept in the settings
          <img src={value} alt="" className="size-24 rounded-md border border-line bg-white object-contain p-1" />
        ) : (
          <div className="flex size-24 items-center justify-center rounded-md border border-dashed border-line text-xs text-muted">No {noun}</div>
        )}
        <div className="flex flex-col gap-2">
          <input id={id} type="file" accept="image/png,image/jpeg,image/webp" className="text-sm" onChange={(e) => choose(e.target.files?.[0])} />
          {value && (
            <button type="button" className="self-start text-sm text-bad underline-offset-2 hover:underline" onClick={() => setValue("")}>
              Remove the {noun}
            </button>
          )}
        </div>
      </div>
    </Field>
  );
}

/**
 * The top of the company's documents as the fields above say right now: the
 * logo (or the title's initials), the title, the line under it, and the names.
 */
function BrandPreview({ initial }: { initial: Record<string, unknown> }) {
  const box = useRef<HTMLDivElement>(null);
  const read = (form: HTMLFormElement | null) => {
    const d = form ? new FormData(form) : null;
    const v = (k: string) => String(d?.get(k) ?? initial[k] ?? "").trim();
    return { logo: v("logo"), mark: v("brandMark"), tagline: v("brandTagline"), name: v("name"), nameLocal: v("nameLocal") };
  };
  const [b, setB] = useState(() => read(null));
  useEffect(() => {
    const form = box.current?.closest("form") ?? null;
    if (!form) return;
    const update = () => setB(read(form));
    update();
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    return () => {
      form.removeEventListener("input", update);
      form.removeEventListener("change", update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read() only uses the form and the first values
  }, []);
  const mark = brandMarkOf(b.mark, b.name || "Company");
  const initials =
    mark
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("") || "·";
  return (
    <div ref={box} className="sm:col-span-2">
      <p className="mb-1.5 text-sm font-medium">The top of your documents</p>
      <div className="overflow-x-auto rounded-lg border border-line bg-white p-5 text-[#1a1a1a]">
        <div className="flex min-w-[26rem] items-center gap-3.5">
          {b.logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- a data URL kept in the settings
            <img src={b.logo} alt="" className="size-[70px] shrink-0 object-contain" />
          ) : (
            <div className="grid size-[62px] shrink-0 place-items-center rounded-full border-[3px] border-[#B08D3C] bg-[#063C8C] text-[22px] font-extrabold text-white">
              {initials}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-[28px] leading-none font-extrabold tracking-[0.14em] text-[#063C8C]">{mark}</div>
            {b.tagline && <div className="mt-0.5 text-[11.5px] font-semibold tracking-[0.18em] text-[#8A6A22]">{b.tagline.toUpperCase()}</div>}
            <div className="mt-0.5 text-[11.5px] text-[#444]">
              {b.name}
              {b.nameLocal && ` · ${b.nameLocal}`}
            </div>
          </div>
        </div>
        <div className="mt-4 flex h-[3px]">
          <div className="flex-[7] bg-[#063C8C]" />
          <div className="flex-[3] bg-[#B08D3C]" />
        </div>
      </div>
    </div>
  );
}

/** A rate as typed text: 6 decimals for big rates, 10 significant digits for small ones (1 PKR = 0.003571428571 USD), so switching the main currency back and forth gives the same numbers. */
const rateText = (n: number | undefined) =>
  n === undefined || !Number.isFinite(n) || n <= 0 ? "" : String(n >= 1 ? Number(n.toFixed(6)) : Number(n.toPrecision(10)));

/**
 * The main currency and, for each other currency, how many of it one unit of
 * the main one buys. Choosing another main currency restates the rates
 * (1 USD = 280 PKR becomes 1 PKR = 0.003571 USD), so nothing has to be retyped.
 * Once money is recorded the main currency is locked (`locked` says why).
 */
function CurrenciesControl({
  f,
  main: initialMain,
  rates: initialRates,
  errors,
  locked,
}: {
  f: SettingField;
  main: string;
  rates: Record<string, string>;
  errors?: string[];
  locked?: string | null;
}) {
  const [main, setMain] = useState(initialMain);
  const [rates, setRates] = useState<Record<string, string>>(initialRates);
  const others = CURRENCIES.filter((c) => c !== main);
  const changeMain = (next: string) => {
    const numeric = Object.fromEntries(
      Object.entries(rates)
        .filter(([, v]) => Number(v) > 0)
        .map(([k, v]) => [k, Number(v)]),
    );
    const restated = restateRates(numeric, main, next);
    setRates(Object.fromEntries(Object.entries(restated).map(([k, v]) => [k, rateText(v)])));
    setMain(next);
  };
  return (
    <fieldset className={cn("flex flex-col gap-3", f.wide && "sm:col-span-2")}>
      <legend className="mb-1 text-sm font-medium">{f.label}</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Main currency" htmlFor="set-currency" hint={locked ?? undefined}>
          <Select
            id="set-currency"
            name={locked ? undefined : "currency"}
            value={main}
            disabled={!!locked}
            onChange={(e) => changeMain(e.target.value)}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c} · {CURRENCY_LABEL[c]}
              </option>
            ))}
          </Select>
          {/* A disabled field is not sent: the locked main currency goes with the form as it is. */}
          {locked && <input type="hidden" name="currency" value={main} />}
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
        <Textarea
          {...common}
          rows={Math.min(8, Math.max(3, text.split("\n").length + 1))}
          className="font-mono text-[13px]"
          spellCheck={false}
        />
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
export function SettingsGroupForm({
  groupKey,
  values,
  action,
  currencyLocked,
}: {
  groupKey: SettingsKey;
  values: Record<string, unknown>;
  action: Action;
  /** Why the main currency cannot change any more (money is recorded against it); null while it can. */
  currencyLocked?: string | null;
}) {
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
            {group.key === "company" && <BrandPreview initial={values} />}
            {fields.map((f) =>
              f.kind === "currencies" ? (
                <CurrenciesControl
                  key={`${f.name}-${s.values?.currency ?? values.currency}`}
                  f={f}
                  main={String(s.values?.currency ?? values.currency ?? "USD")}
                  rates={
                    s.values
                      ? Object.fromEntries(CURRENCIES.map((c) => [c, s.values?.[`rate_${c}`] ?? ""]))
                      : Object.fromEntries(
                          Object.entries((values.exchangeRates ?? {}) as Record<string, number>).map(([k, v]) => [k, rateText(v)]),
                        )
                  }
                  errors={[...(s.errors?.currency ?? []), ...(s.errors?.exchangeRates ?? [])]}
                  locked={currencyLocked}
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
