"use client";

import type { SettingsKey } from "@kebo/shared";
import { Card, CardBody, CardFooter, CardHeader, Checkbox, cn, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import { SETTING_GROUPS, toFormText, type SettingField } from "./groups";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

function Control({ f, text, checked, error }: { f: SettingField; text: string; checked: boolean; error?: string[] }) {
  const id = `set-${f.name}`;
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
      ) : f.kind === "lines" || f.kind === "rates" ? (
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
        <Input {...common} className={f.name === "currency" ? "w-28 uppercase" : undefined} maxLength={f.name === "currency" ? 3 : undefined} />
      )}
    </Field>
  );
}

/** One settings group as its own form with its own Save button. */
export function SettingsGroupForm({ groupKey, values, action }: { groupKey: SettingsKey; values: Record<string, unknown>; action: Action }) {
  const group = SETTING_GROUPS.find((g) => g.key === groupKey)!;
  return (
    <ActionForm action={action}>
      {(s) => (
        <Card id={group.key} className="scroll-mt-20">
          <CardHeader title={group.title} description={group.description} />
          <CardBody className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
            {group.fields.map((f) => (
              <Control
                key={f.name}
                f={f}
                text={s.values ? (s.values[f.name] ?? "") : toFormText(f, values[f.name])}
                checked={s.values ? s.values[f.name] === "on" : values[f.name] === true}
                error={s.errors?.[f.name]}
              />
            ))}
          </CardBody>
          <CardFooter>
            <SubmitButton pendingText="Saving…">{group.save}</SubmitButton>
          </CardFooter>
        </Card>
      )}
    </ActionForm>
  );
}
