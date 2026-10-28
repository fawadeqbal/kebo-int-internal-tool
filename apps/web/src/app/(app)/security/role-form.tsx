"use client";

import { useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { PERMISSION_GROUPS, type Permission } from "@kebo/shared";
import { Alert, buttonClass, Checkbox, cn, Field, Input, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * A role: its name, what it is for, its permissions in groups (with "all" per
 * group) and whether its people must use two-step sign-in. The Super Admin's
 * name and permissions are fixed. Permissions the editor does not have
 * themselves cannot be given (the API says the same).
 */
export function RoleForm({
  action,
  role,
  mine,
  isMine = false,
  locked = false,
  submitLabel,
}: {
  action: Action;
  role?: { name: string; description: string | null; permissions: Permission[]; superAdmin: boolean; requireTwoStep: boolean };
  /** The editor's own permissions; null for a Super Admin (may give anything). */
  mine: Permission[] | null;
  /** The editor's own role: Security must stay in it. */
  isMine?: boolean;
  /** The company's plan leaves out custom roles: the name and permissions stay as they are. */
  locked?: boolean;
  submitLabel: string;
}) {
  const superAdmin = !!role?.superAdmin;
  const fixed = superAdmin || locked;
  const [picked, setPicked] = useState<Set<Permission>>(() => new Set(role?.permissions ?? ["dashboard.view"]));
  const may = (p: Permission) => !mine || mine.includes(p) || picked.has(p);
  const toggle = (p: Permission, on: boolean) =>
    setPicked((s) => {
      const n = new Set(s);
      if (on) n.add(p);
      else n.delete(p);
      return n;
    });
  return (
    <ActionForm action={action} keepFields className="flex flex-col gap-5">
      {(s) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="name" error={s.errors?.name} hint={superAdmin ? "The Super Admin role keeps its name." : locked ? "Renaming roles is part of custom roles." : "What people will see, e.g. Accounts or Sales (China)."}>
              <Input id="name" name="name" defaultValue={s.values?.name ?? role?.name} readOnly={fixed} autoFocus={!role} aria-invalid={!!s.errors?.name} />
            </Field>
            <Field label="What it is for" htmlFor="description" error={s.errors?.description} hint="Shown when someone is given the role.">
              <Textarea id="description" name="description" rows={2} defaultValue={s.values?.description ?? role?.description ?? ""} maxLength={300} />
            </Field>
          </div>

          <label className="flex items-start gap-3 rounded-lg border border-line p-3">
            <Checkbox name="requireTwoStep" defaultChecked={role?.requireTwoStep ?? false} className="mt-0.5" />
            <span className="text-sm">
              <span className="flex items-center gap-1.5 font-medium">
                <ShieldCheck className="size-4 text-ok" aria-hidden /> Needs two-step sign-in
              </span>
              <span className="block text-text-2">
                Everyone in this role must use a code from their phone as well as their password. Anyone who has not set it up yet must do so at their next click; nothing
                else opens until they have, and they cannot turn it off.
              </span>
            </span>
          </label>

          <fieldset className="flex flex-col gap-4">
            <legend className="mb-1 text-sm font-semibold">What people in this role may do</legend>
            {superAdmin && <Alert tone="info">The Super Admin always has every permission, including any added later. Only the description and the two-step rule change here.</Alert>}
            {locked && !superAdmin && (
              <Alert tone="info">Changing what a role allows is part of custom roles, which your company&apos;s plan does not include. The description and the two-step rule still change here.</Alert>
            )}
            {s.errors?.permissions && <p className="text-sm text-bad">{s.errors.permissions[0]}</p>}
            <div className="grid gap-4 md:grid-cols-2">
              {PERMISSION_GROUPS.map((g) => {
                const open = g.items.filter((i) => may(i.permission));
                const all = open.length > 0 && open.every((i) => picked.has(i.permission));
                return (
                  <div key={g.title} className="rounded-lg border border-line">
                    <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2/60 px-3 py-2">
                      <p className="text-xs font-semibold tracking-wide text-text-2 uppercase">{g.title}</p>
                      {!fixed && open.length > 1 && (
                        <button
                          type="button"
                          className="text-xs font-medium text-primary hover:underline"
                          onClick={() => open.forEach((i) => toggle(i.permission, !all))}
                          aria-label={`${all ? "Clear" : "Choose"} all in ${g.title}`}
                        >
                          {all ? "Clear all" : "All"}
                        </button>
                      )}
                    </div>
                    <ul className="flex flex-col">
                      {g.items.map((i) => {
                        const id = `perm-${i.permission}`;
                        const blocked = !fixed && !may(i.permission);
                        const keep = !fixed && isMine && i.permission === "security.manage";
                        return (
                          <li key={i.permission} className="border-b border-line last:border-b-0">
                            <label htmlFor={id} className={cn("flex items-start gap-3 px-3 py-2", (blocked || fixed || keep) && "cursor-not-allowed")}>
                              <Checkbox
                                id={id}
                                name="permissions"
                                value={i.permission}
                                checked={superAdmin || picked.has(i.permission)}
                                disabled={fixed || blocked}
                                onChange={(e) => !keep && toggle(i.permission, e.target.checked)}
                                className="mt-0.5"
                              />
                              <span className="min-w-0 text-sm">
                                <span className={cn("font-medium", blocked && "text-muted")}>{i.label}</span>
                                {i.hint && <span className="block text-xs text-muted">{i.hint}</span>}
                                {blocked && <span className="block text-xs text-muted">Your own role does not have this, so you cannot give it.</span>}
                                {keep && <span className="block text-xs text-muted">Stays: this is your own role.</span>}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </fieldset>

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Link href="/security" className={buttonClass("ghost")}>
              Cancel
            </Link>
            <SubmitButton pendingText="Saving…">{submitLabel}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
