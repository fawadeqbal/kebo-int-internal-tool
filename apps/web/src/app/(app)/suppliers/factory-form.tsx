"use client";

import { useState } from "react";
import { Factory as FactoryIcon, Landmark, Phone } from "lucide-react";
import { cn, Field, Input, Select, Textarea, RULES } from "@kebo/ui";
import { toast } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { PANEL_FORM, PanelBody, SidePanel, useSidePanel } from "@/components/common/panel";
import { JumpToStep, StepsFooter, StepsFrame } from "@/components/common/steps-frame";
import type { ActionState } from "@/lib/actions";
import type { Person } from "@/lib/types";
import type { Factory } from "@/lib/types-people";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

type SupplierStep = "who" | "contact" | "paying";
const SUPPLIER_STEPS: { key: SupplierStep; label: string; icon: typeof FactoryIcon }[] = [
  { key: "who", label: "Who they are", icon: FactoryIcon },
  { key: "contact", label: "Contact and address", icon: Phone },
  { key: "paying", label: "Paying them", icon: Landmark },
];
const CONTACT_KEYS = new Set(["contactPerson", "phone", "wechat", "email", "address"]);
/** The step of a refused field. */
const stepOfField = (k: string): SupplierStep => (CONTACT_KEYS.has(k) ? "contact" : k === "bankDetails" || k === "notes" ? "paying" : "who");

/**
 * A supplier's details in steps (three parts, design rule 1): who it is and who looks after it, how to reach it, and
 * how to pay it. Every step's fields stay in the form (the ones not shown are hidden), so what was typed on a step
 * stays and is sent with the rest. After an error the typed values stay (s.values), otherwise the saved ones show.
 */
function FactoryForm({
  action,
  factory,
  people,
  meId,
  onSaved,
}: {
  action: Action;
  factory: Factory | null;
  people: Person[];
  meId: string;
  onSaved: (s: ActionState) => void;
}) {
  const [step, setStep] = useState<SupplierStep>("who");
  const at = Math.max(0, SUPPLIER_STEPS.findIndex((x) => x.key === step));
  const last = at === SUPPLIER_STEPS.length - 1;
  const go = (i: number) => setStep(SUPPLIER_STEPS[Math.max(0, Math.min(SUPPLIER_STEPS.length - 1, i))]!.key);
  const grid = "grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-3";
  return (
    <PanelBody fill>
      <ActionForm
        action={action}
        onDone={onSaved}
        showSuccess={false}
        reveal={(k) => setStep(stepOfField(k))}
        className={cn(PANEL_FORM, "min-h-0 gap-0")}
        // A new supplier is saved from its last step: Enter on an earlier one goes on to the next.
        beforeSend={() => {
          if (factory || last) return true;
          go(at + 1);
          return false;
        }}
      >
        {(s) => {
          const val = (k: keyof Factory) => s.values?.[k] ?? (factory?.[k] === null || factory?.[k] === undefined ? "" : String(factory[k]));
          const invalid = (k: string) => (s.errors?.[k] ? { "aria-invalid": true } : {});
          return (
            <>
              <JumpToStep errors={s.errors} stepOf={stepOfField} onJump={setStep} />
              <StepsFrame
                steps={SUPPLIER_STEPS.map((x, k) => ({ key: x.key, label: x.label, icon: x.icon, done: !factory && k < at }))}
                at={step}
                onGo={setStep}
                footer={
                  <StepsFooter
                    onBack={at > 0 ? () => go(at - 1) : null}
                    // Editing, it can be saved from any step; a new one, from its last.
                    jump={factory && !last ? { label: "Save now" } : null}
                    onNext={last ? null : () => go(at + 1)}
                    save={{ label: factory ? "Save" : "Add the supplier" }}
                  />
                }
              >
                <div className={cn(grid, step !== "who" && "hidden")}>
              <Field label="Supplier name" required htmlFor="name" error={s.errors?.name} className="sm:col-span-2">
                <Input id="name" name="name" defaultValue={val("name")} autoComplete="organization" {...invalid("name")} />
              </Field>
              <Field label="Responsible person" htmlFor="ownerId" error={s.errors?.ownerId}>
                <Select id="ownerId" name="ownerId" defaultValue={s.values?.ownerId ?? (factory ? (factory.ownerId ?? "") : meId)}>
                  <option value="">Nobody yet</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id === meId ? `${p.name} (me)` : p.name}
                    </option>
                  ))}
                </Select>
              </Field>
                </div>
                <div className={cn(grid, step !== "contact" && "hidden")}>
              <Field label="Contact person" htmlFor="contactPerson" error={s.errors?.contactPerson}>
                <Input id="contactPerson" name="contactPerson" defaultValue={val("contactPerson")} />
              </Field>
              <Field label="Phone" htmlFor="phone" error={s.errors?.phone}>
                <Input id="phone" name="phone" type="tel" defaultValue={val("phone")} {...invalid("phone")} />
              </Field>
              <Field label="WeChat" htmlFor="wechat" error={s.errors?.wechat}>
                <Input id="wechat" name="wechat" defaultValue={val("wechat")} />
              </Field>
              <Field label="Email" htmlFor="email" error={s.errors?.email}>
                <Input id="email" name="email" type="email" defaultValue={val("email")} {...invalid("email")} />
              </Field>
              <Field label="Address" htmlFor="address" error={s.errors?.address} className="sm:col-span-2">
                <Input id="address" name="address" defaultValue={val("address")} />
              </Field>
                </div>
                <div className={cn(grid, step !== "paying" && "hidden")}>
              <Field label="Bank details" htmlFor="bankDetails" error={s.errors?.bankDetails} className="sm:col-span-3">
                <Textarea
                  id="bankDetails"
                  name="bankDetails"
                  rows={3}
                  defaultValue={val("bankDetails")}
                />
              </Field>
              <Field label="Notes" htmlFor="notes" error={s.errors?.notes} className="sm:col-span-3">
                <Textarea id="notes" name="notes" rows={3} defaultValue={val("notes")} />
              </Field>
                </div>
              </StepsFrame>
            </>
          );
        }}
      </ActionForm>
    </PanelBody>
  );
}

/**
 * "New factory" (over the list, ?panel=new-factory) and "Edit factory · name"
 * (over the list or the factory's page, ?panel=edit-factory&id=…) in the side
 * panel. After a save it closes, the page updates in place with the row or
 * the Details card lit for 2 seconds, and a toast says so.
 */
export function FactoryPanel({
  action,
  factory,
  people,
  meId,
  onRecord,
}: {
  action: Action;
  factory: Factory | null;
  people: Person[];
  meId: string;
  /** Opened on the factory's own page (no "Open" in the toast). */
  onRecord?: boolean;
}) {
  const panel = useSidePanel(factory ? "edit-factory" : "new-factory");
  const saved = (s: ActionState) => {
    const d = s.data as { id: string; name: string } | undefined;
    if (!d) return panel.close();
    toast({
      message: factory ? `${d.name} saved` : `Supplier ${d.name} added`,
      action: onRecord ? undefined : { label: "Open", href: `/suppliers/${d.id}` },
    });
    panel.close({ saved: d.id });
  };
  return (
    <SidePanel
      title={factory ? `Edit supplier · ${factory.name}` : "New supplier"}
      description={
        factory
          ? "Changes apply to new prices and orders; past ones keep what was agreed."
          : "Who they are, where they are, and the people you talk to."
      }
      onClose={() => panel.close()}
      className={RULES.window.items}
    >
      <FactoryForm action={action} factory={factory} people={people} meId={meId} onSaved={saved} />
    </SidePanel>
  );
}
