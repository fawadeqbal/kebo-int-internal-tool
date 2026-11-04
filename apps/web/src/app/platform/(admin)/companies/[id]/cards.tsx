"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { MODULE_PRESETS, ORDER_FLOW_FEATURES, PLAN_FEATURE_KEYS, PLAN_FEATURES, planFeatureName, withPreset } from "@kebo/shared";
import { Badge, Button, Card, cn } from "@kebo/ui";
import { toast } from "@kebo/ui/client";
import { EditButton } from "@/components/common/edit-button";
import { useSidePanel } from "@/components/common/panel";
import { Switch } from "@/components/common/switch-list";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export interface GroupValue {
  label: string;
  /** null / "": missing — "+ Add" in place when the card can be edited. */
  value: ReactNode;
  wide?: boolean;
  /** Lives elsewhere: shown as it is, with no "+ Add" (e.g. "from their Settings"). */
  readOnly?: boolean;
}

const missing = (v: ReactNode) => v === null || v === undefined || v === "";

/**
 * A group of details in its own card (design system: Settings frame / record
 * Details): title, one line of what it holds, ✎ Edit in the header for its
 * side panel; the values read-only, label above value, a missing one "+ Add"
 * in place. Without `panel` the card is read-only (the values live elsewhere,
 * said in `note`).
 */
export function GroupCard({
  id,
  title,
  description,
  items,
  panel,
  editLabel,
  note,
  flash,
  columns = 3,
}: {
  id: string;
  title: string;
  description: string;
  items: GroupValue[];
  panel?: string;
  editLabel?: string;
  /** Under the values: where read-only values are changed. */
  note?: ReactNode;
  flash?: boolean;
  columns?: 2 | 3;
}) {
  const p = useSidePanel(panel ?? "");
  return (
    <Card id={id} aria-labelledby={`${id}-title`} className={cn("scroll-mt-20", flash && "animate-flash")}>
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-sm font-semibold text-text">
            {title}
          </h2>
          <p className="mt-0.5 text-xs text-muted">{description}</p>
        </div>
        {panel && (
          <EditButton aria-label={editLabel ?? `Edit ${title.toLowerCase()}`} aria-haspopup="dialog" onClick={() => p.openPanel()} />
        )}
      </div>
      <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3 px-4 py-3.5 sm:grid-cols-2 sm:gap-y-4", columns === 3 && "xl:grid-cols-3")}>
        {items.map((i) => (
          <div
            key={i.label}
            className={cn("flex min-w-0 items-baseline justify-between gap-3 sm:block", i.wide && "sm:col-span-2 xl:col-span-3")}
          >
            <dt className="shrink-0 text-xs text-text-2 sm:mb-0.5">{i.label}</dt>
            <dd className="min-w-0 text-right text-sm font-medium break-words text-text sm:text-left">
              {missing(i.value) ? (
                panel && !i.readOnly ? (
                  <button
                    type="button"
                    onClick={() => p.openPanel()}
                    aria-label={`Add ${i.label.toLowerCase()}`}
                    className="font-semibold text-primary hover:underline"
                  >
                    + Add
                  </button>
                ) : (
                  <span className="text-muted">—</span>
                )
              ) : (
                i.value
              )}
            </dd>
          </div>
        ))}
      </dl>
      {note && <p className="border-t border-line px-4 py-2.5 text-xs text-text-2">{note}</p>}
    </Card>
  );
}

/** A secondary button that opens one of the page's side panels (Change plan, + Record payment, Extend…). */
export function PanelButton({
  panel,
  id,
  children,
  label,
  variant = "secondary",
  className,
}: {
  panel: string;
  id?: string;
  children: ReactNode;
  label?: string;
  variant?: "secondary" | "ghost" | "link";
  className?: string;
}) {
  const p = useSidePanel(panel);
  return (
    <Button
      size="sm"
      variant={variant}
      aria-label={label}
      aria-haspopup="dialog"
      className={cn(variant !== "link" && "h-8 px-2.5 text-[13px] [&_svg]:size-3.5", variant === "link" && "h-auto p-0 text-xs", className)}
      onClick={() => p.openPanel(id)}
    >
      {children}
    </Button>
  );
}

/**
 * The modules this company uses (design system: switch list): every module,
 * on or off, each switch saving at once; one not in the plan says so instead
 * of a switch, one switched off says when and by whom. The order-flow presets
 * set those modules in one click.
 */
export function ModulesList({
  planFeatures,
  featuresOff,
  since,
  action,
  disabled,
}: {
  planFeatures: string[] | null;
  featuresOff: string[];
  since: Record<string, string>;
  action: Action;
  /** A deleted company: nothing to switch. */
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [off, setOff] = useState<string[]>(featuresOff);
  const inPlan = (f: string) => !planFeatures || planFeatures.includes(f);

  const save = (next: string[], said: string, back: string[]) => {
    setOff(next);
    start(async () => {
      const form = new FormData();
      for (const f of next) form.append("off", f);
      const r = await action({}, form);
      if (r.ok === false) {
        setOff(back);
        toast(r.message ?? "Could not save that. Try again.");
        return;
      }
      toast(`Saved · ${said}`);
      router.refresh();
    });
  };

  const onNow = PLAN_FEATURE_KEYS.filter((f) => inPlan(f) && !off.includes(f));
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5">
        <span className="text-xs text-text-2">Order-flow modules in one click:</span>
        {MODULE_PRESETS.map((p) => {
          const next = withPreset(onNow, p);
          const same = [...next].sort().join() === [...onNow].sort().join();
          return (
            <Button
              key={p.key}
              type="button"
              size="xs"
              variant="secondary"
              disabled={disabled || pending}
              className="aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:text-primary"
              title={p.hint}
              aria-pressed={same}
              onClick={() =>
                save(
                  [
                    ...off.filter((f) => !(ORDER_FLOW_FEATURES as readonly string[]).includes(f)),
                    ...ORDER_FLOW_FEATURES.filter((f) => inPlan(f) && !next.includes(f)),
                  ],
                  p.name,
                  off,
                )
              }
            >
              {p.name}
            </Button>
          );
        })}
      </div>
      <ul aria-label="Modules" aria-busy={pending || undefined} className="flex flex-col divide-y divide-line">
        {PLAN_FEATURE_KEYS.map((f) => {
          const plan = inPlan(f);
          const on = plan && !off.includes(f);
          const id = `module-${f}`;
          const what = PLAN_FEATURES[f].match(/\((.*)\)/)?.[1] ?? "";
          const hint = !plan ? "Not in their plan: change the plan to add it" : !on ? (since[f] ?? "Switched off for this company") : what;
          return (
            <li key={f} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <label htmlFor={plan ? id : undefined} className={cn("min-w-0", plan && "cursor-pointer")}>
                <span className={cn("block text-sm font-medium", !on && "text-text-2")}>{planFeatureName(f)}</span>
                <span className={cn("block text-xs", plan && !on ? "text-warn" : "text-muted")}>{hint}</span>
              </label>
              {plan ? (
                <span className="flex shrink-0 items-center gap-2">
                  <span className={cn("text-xs", on ? "text-ok" : "text-muted")} aria-hidden>
                    {on ? "On" : "Off"}
                  </span>
                  <Switch
                    id={id}
                    checked={on}
                    disabled={disabled || pending}
                    label={`${planFeatureName(f)}: ${on ? "on" : "off"}`}
                    onChange={(next) =>
                      save(next ? off.filter((x) => x !== f) : [...off, f], `${planFeatureName(f)} ${next ? "on" : "off"}`, off)
                    }
                  />
                </span>
              ) : (
                <Badge tone="neutral">not in plan</Badge>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
