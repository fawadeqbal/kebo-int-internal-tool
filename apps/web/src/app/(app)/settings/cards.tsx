"use client";

import { CURRENCIES, CURRENCY_LABEL } from "@kebo/shared";
import { Card, CardBody, CardHeader, cn } from "@kebo/ui";
import { SubmitButton, toast } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { EditButton } from "@/components/common/edit-button";
import { useFeature } from "@/components/common/features";
import { PANEL_FORM, PanelActions, PanelBody, PanelKeys, PanelSection, SidePanel, useClosePanel, useSidePanel } from "@/components/common/panel";
import { SwitchList } from "@/components/common/switch-list";
import type { ActionState } from "@/lib/actions";
import { BrandPreview, Control, CurrenciesControl, rateText } from "./forms";
import { SETTING_GROUPS, toFormText, type SettingCard, type SettingField, type SettingGroup } from "./groups";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

const empty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/** One stored value, read-only, as people say it ("15 %", "Balance before shipment"). */
function ValueText({ f, value }: { f: SettingField; value: unknown }) {
  if (f.kind === "image")
    // eslint-disable-next-line @next/next/no-img-element -- a data URL kept in the settings
    return <img src={String(value)} alt={f.label} className="size-16 rounded-md border border-line bg-white object-contain p-1" />;
  if (f.kind === "lines")
    return (
      <span className="flex flex-wrap gap-1.5">
        {(value as string[]).map((x) => (
          <span key={x} className="rounded-md bg-surface-2 px-2 py-0.5 text-[13px]">
            {x}
          </span>
        ))}
      </span>
    );
  if (f.kind === "select") return <>{f.options?.find((o) => o.value === String(value))?.label ?? String(value)}</>;
  if (f.kind === "number")
    return (
      <span className="tabular">
        {String(value)}
        {f.unit && ` ${f.unit}`}
      </span>
    );
  if (f.kind === "bool") return <>{value ? "On" : "Off"}</>;
  return <span className={cn("break-words", f.kind === "textarea" && "whitespace-pre-line")}>{String(value)}</span>;
}

/** The main currency and the rates, read-only; a missing rate says so (it blocks quotations in that currency). */
function CurrenciesText({ values }: { values: Record<string, unknown> }) {
  const main = String(values.currency ?? "USD");
  const rates = (values.exchangeRates ?? {}) as Record<string, number>;
  return (
    <div className="flex flex-col gap-1.5">
      <span>
        <span className="font-medium">{main}</span> · {CURRENCY_LABEL[main as keyof typeof CURRENCY_LABEL] ?? main} <span className="text-muted">(main)</span>
      </span>
      <ul className="flex flex-col gap-0.5 text-[13px]">
        {CURRENCIES.filter((c) => c !== main).map((c) => (
          <li key={c} className="tabular">
            {rates[c] ? (
              <>
                1 {main} = {rateText(rates[c])} {c}
              </>
            ) : (
              <span className="text-warn">
                No rate for {c} yet · quotations in {c} need one
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A settings card (design system: Settings frame): title, one line of what it
 * holds, ✎ Edit in its header; the values read-only, a missing one as "+ Add"
 * in place. Edit and + Add open the card's fields in the side panel
 * (?panel=settings-<card>), which saves only them.
 */
export function SettingsCard({
  group,
  card,
  values,
  action,
  currencyLocked,
}: {
  group: SettingGroup;
  card: SettingCard;
  values: Record<string, unknown>;
  action: Action;
  currencyLocked: string | null;
}) {
  const emailReports = useFeature("email_reports");
  const panel = useSidePanel(`settings-${card.key}`);
  const fields = card.fields.map((n) => group.fields.find((f) => f.name === n)!).filter((f) => emailReports || f.name !== "dailySummary");

  if (card.switches)
    return (
      <Card id={card.key} className="scroll-mt-20">
        <CardHeader title={card.title} description={card.description} />
        <SwitchList
          label={card.title}
          items={fields.map((f) => ({ key: f.name, label: f.label, hint: f.hint, on: values[f.name] === true }))}
          save={(key, on) => {
            const form = new FormData();
            form.set("_fields", key);
            if (on) form.set(key, "on");
            return action({}, form);
          }}
        />
      </Card>
    );

  return (
    <Card id={card.key} className="scroll-mt-20">
      <CardHeader
        title={card.title}
        description={card.description}
        // ✎ Edit stays top right on a phone too (design system: card header actions).
        className="max-sm:flex-row max-sm:gap-3"
        actions={<EditButton aria-label={`Edit ${card.title.toLowerCase()}`} onClick={() => panel.openPanel()} />}
      />
      <CardBody className="flex flex-col gap-4">
        {card.preview && <BrandPreview initial={values} label={null} />}
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {fields.map((f) => {
            const value = f.kind === "currencies" ? values.currency : values[f.name];
            const wide = f.wide || f.kind === "currencies";
            return (
              <div key={f.name} className={cn("min-w-0", wide && "sm:col-span-2")}>
                {/* A card of one value is named by its title already. */}
                <dt className={cn("text-xs text-muted", fields.length === 1 && "sr-only")}>{f.label}</dt>
                <dd className="mt-0.5 text-sm text-text">
                  {f.kind === "currencies" ? (
                    <CurrenciesText values={values} />
                  ) : empty(value) ? (
                    <button type="button" onClick={() => panel.openPanel()} className="font-medium text-primary hover:underline">
                      + Add
                    </button>
                  ) : (
                    <ValueText f={f} value={value} />
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      </CardBody>
      {panel.open && (
        <SidePanel title={`Edit ${card.title.toLowerCase()}`} description={card.description} onClose={() => panel.close()}>
          <PanelBody>
            <CardForm card={card} fields={fields} values={values} action={action} currencyLocked={currencyLocked} onSaved={() => panel.close()} />
          </PanelBody>
        </SidePanel>
      )}
    </Card>
  );
}

/** The card's fields in the panel; it sends only them (`_fields`), the rest of the group stays as stored. */
function CardForm({
  card,
  fields,
  values,
  action,
  currencyLocked,
  onSaved,
}: {
  card: SettingCard;
  fields: SettingField[];
  values: Record<string, unknown>;
  action: Action;
  currencyLocked: string | null;
  onSaved: () => void;
}) {
  const close = useClosePanel();
  return (
    <ActionForm
      action={action}
      showSuccess={false}
      className={PANEL_FORM}
      onDone={(s) => {
        toast(s.message ?? `Saved · ${card.title}`);
        onSaved();
      }}
    >
      {(s) => (
        <>
          <input type="hidden" name="_fields" value={fields.map((f) => f.name).join(",")} />
          {s.ok === false && s.errors && Object.keys(s.errors).length > 0 && (
            <p role="alert" className="text-sm text-bad">
              {s.message ?? "Some values need fixing."}
            </p>
          )}
          <PanelSection first>
            {card.preview && <BrandPreview initial={values} />}
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
                  locked={currencyLocked}
                  dates={(values.rateDates ?? {}) as Record<string, string>}
                  today={new Date().toISOString().slice(0, 10)}
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
          </PanelSection>
          <PanelActions>
            <SubmitButton pendingText="Saving…">Save</SubmitButton>
            <button type="button" className="text-sm font-medium text-text-2 hover:text-text" onClick={() => close()}>
              Cancel
            </button>
            <PanelKeys />
          </PanelActions>
        </>
      )}
    </ActionForm>
  );
}

/** Every card of one settings section. */
export function SettingsCards({
  groupKey,
  values,
  action,
  currencyLocked,
}: {
  groupKey: SettingGroup["key"];
  values: Record<string, unknown>;
  action: Action;
  currencyLocked: string | null;
}) {
  const group = SETTING_GROUPS.find((g) => g.key === groupKey)!;
  return (
    <>
      {group.cards.map((c) => (
        <SettingsCard key={c.key} group={group} card={c} values={values} action={action} currencyLocked={currencyLocked} />
      ))}
    </>
  );
}
