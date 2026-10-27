"use client";

import { useState } from "react";
import Link from "next/link";
import { buttonClass, Field, Input, Select } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import type { RoleRow } from "@/lib/types-people";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

const PASSWORD_HINT = "At least 10 characters, with letters and at least one number.";

/** The roles they may be given: those within the giver's own (the current one always shows). */
function RoleField({ value, roles, error, disabled }: { value: string; roles: RoleRow[]; error?: string[]; disabled?: boolean }) {
  const [picked, setPicked] = useState(value);
  const options = roles.filter((r) => r.givable || r.key === value);
  const role = roles.find((r) => r.key === picked);
  const hint = disabled
    ? "You cannot change your own role."
    : role
      ? `${role.description ?? ""}${role.requireTwoStep ? `${role.description ? " " : ""}Needs two-step sign-in: they set it up when they first sign in.` : ""}`
      : undefined;
  return (
    <Field label="Role" htmlFor="role" error={error} hint={hint || undefined}>
      {/* Keyed by the value: a select's default only applies when it mounts, and React resets the form after each submit. */}
      <Select key={value} id="role" name="role" defaultValue={value} disabled={disabled} onChange={(e) => setPicked(e.target.value)}>
        {options.map((r) => (
          <option key={r.key} value={r.key} disabled={!r.givable}>
            {r.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function NewUserForm({ action, roles }: { action: Action; roles: RoleRow[] }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-4">
      {(s) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="name" error={s.errors?.name}>
              <Input id="name" name="name" defaultValue={s.values?.name} autoFocus aria-invalid={!!s.errors?.name} />
            </Field>
            <Field label="Email" htmlFor="email" error={s.errors?.email} hint="They sign in with this">
              <Input id="email" name="email" type="email" autoComplete="off" defaultValue={s.values?.email} aria-invalid={!!s.errors?.email} />
            </Field>
            <RoleField value={s.values?.role ?? (roles.some((r) => r.key === "staff" && r.givable) ? "staff" : (roles.find((r) => r.givable)?.key ?? ""))} roles={roles} error={s.errors?.role} />
            <Field label="First password" htmlFor="password" error={s.errors?.password} hint={`${PASSWORD_HINT} Give it to them privately; they can change it under My account.`}>
              <Input id="password" name="password" type="text" autoComplete="new-password" spellCheck={false} defaultValue={s.values?.password} aria-invalid={!!s.errors?.password} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Link href="/users" className={buttonClass("ghost")}>
              Cancel
            </Link>
            <SubmitButton pendingText="Adding…">Add the person</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function EditUserForm({ action, user, roles, isMe }: { action: Action; user: { name: string; email: string; role: string }; roles: RoleRow[]; isMe: boolean }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-4">
      {(s) => (
        <>
          <Field label="Name" htmlFor="name" error={s.errors?.name}>
            <Input id="name" name="name" defaultValue={s.values?.name ?? user.name} aria-invalid={!!s.errors?.name} />
          </Field>
          <Field label="Email" htmlFor="email" error={s.errors?.email} hint="They sign in with this">
            <Input id="email" name="email" type="email" defaultValue={s.values?.email ?? user.email} aria-invalid={!!s.errors?.email} />
          </Field>
          {/* A disabled select sends nothing, so the current role goes along hidden. */}
          {isMe && <input type="hidden" name="role" value={user.role} />}
          <RoleField value={s.values?.role ?? user.role} roles={roles} error={s.errors?.role} disabled={isMe} />
          <div>
            <SubmitButton size="sm" pendingText="Saving…">
              Save details
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function SetPasswordForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} resetOnSuccess className="flex flex-col gap-3">
      {(s) => (
        <>
          <Field label="New password" htmlFor="new-password" error={s.errors?.password} hint={PASSWORD_HINT}>
            <Input id="new-password" name="password" type="text" autoComplete="new-password" spellCheck={false} aria-invalid={!!s.errors?.password} />
          </Field>
          <div>
            <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
              Set the new password
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
