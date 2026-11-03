"use client";

import { useState, type ReactNode } from "react";
import { Button, Field, Input, Select } from "@kebo/ui";
import { SubmitButton, toast } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { PANEL_FORM, PanelActions, PanelBody, PanelKeys, PanelSection, SidePanel, useClosePanel, useSidePanel } from "@/components/common/panel";
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

/** A user form in the side panel: its groups, then Save / Cancel pinned at the bottom. */
function PanelForm({ action, onSaved, save, pending, children }: { action: Action; onSaved: (s: ActionState) => void; save: string; pending: string; children: (s: ActionState) => ReactNode }) {
  const close = useClosePanel();
  return (
    <ActionForm action={action} onDone={onSaved} showSuccess={false} className="flex min-h-0 flex-1 flex-col">
      {(s) => (
        <PanelBody className={PANEL_FORM}>
          {children(s)}
          <PanelActions className="max-md:[&>button:first-child]:flex-1">
            <SubmitButton pendingText={pending}>{save}</SubmitButton>
            <Button variant="ghost" onClick={close} className="max-md:hidden">
              Cancel
            </Button>
            <PanelKeys />
          </PanelActions>
        </PanelBody>
      )}
    </ActionForm>
  );
}

const invalid = (error: unknown) => (error ? { "aria-invalid": true } : {});

/**
 * "Add a person" in the side panel over Users (?panel=new-user). They can
 * sign in as soon as it is saved; the list updates in place with their row
 * lit, and a toast says so.
 */
export function NewUserPanel({ action, roles }: { action: Action; roles: RoleRow[] }) {
  const panel = useSidePanel("new-user");
  const saved = (s: ActionState) => {
    const d = s.data as { id: string; name: string } | undefined;
    if (!d) return panel.close();
    toast({ message: `${d.name} can now sign in`, action: { label: "Open", href: `/users/${d.id}` } });
    panel.close({ saved: d.id });
  };
  const start = roles.some((r) => r.key === "staff" && r.givable) ? "staff" : (roles.find((r) => r.givable)?.key ?? "");
  return (
    <SidePanel title="Add a person" description="They can sign in as soon as you save. Choose the smallest role that lets them do their work." onClose={() => panel.close()}>
      <PanelForm action={action} onSaved={saved} save="Add the person" pending="Adding…">
        {(s) => (
          <>
            <PanelSection title="Who" first>
              <Field label="Name" htmlFor="name" error={s.errors?.name}>
                <Input id="name" name="name" autoComplete="off" defaultValue={s.values?.name} {...invalid(s.errors?.name)} />
              </Field>
              <Field label="Email" htmlFor="email" error={s.errors?.email} hint="They sign in with this">
                <Input id="email" name="email" type="email" autoComplete="off" defaultValue={s.values?.email} {...invalid(s.errors?.email)} />
              </Field>
            </PanelSection>
            <PanelSection title="Access">
              <RoleField value={s.values?.role ?? start} roles={roles} error={s.errors?.role} />
              <Field label="First password" htmlFor="password" error={s.errors?.password} hint={`${PASSWORD_HINT} Give it to them privately; they can change it under My account.`}>
                <Input id="password" name="password" type="text" autoComplete="new-password" spellCheck={false} defaultValue={s.values?.password} {...invalid(s.errors?.password)} />
              </Field>
            </PanelSection>
          </>
        )}
      </PanelForm>
    </SidePanel>
  );
}

/**
 * "Edit person · name" in the side panel on their page (?panel=edit-user&id=…):
 * name, sign-in email and role. A new role takes effect at once.
 */
export function EditUserPanel({ action, user, roles, isMe }: { action: Action; user: { id: string; name: string; email: string; role: string }; roles: RoleRow[]; isMe: boolean }) {
  const panel = useSidePanel("edit-user");
  const saved = () => {
    toast("Saved. A new role takes effect at once (they sign in again).");
    panel.close({ saved: user.id });
  };
  return (
    <SidePanel title={`Edit person · ${user.name}`} description="Name, sign-in email and what they may do." onClose={() => panel.close()}>
      <PanelForm action={action} onSaved={saved} save="Save changes" pending="Saving…">
        {(s) => (
          <>
            <PanelSection title="Who" first>
              <Field label="Name" htmlFor="name" error={s.errors?.name}>
                <Input id="name" name="name" defaultValue={s.values?.name ?? user.name} {...invalid(s.errors?.name)} />
              </Field>
              <Field label="Email" htmlFor="email" error={s.errors?.email} hint="They sign in with this">
                <Input id="email" name="email" type="email" defaultValue={s.values?.email ?? user.email} {...invalid(s.errors?.email)} />
              </Field>
            </PanelSection>
            <PanelSection title="Access">
              {/* A disabled select sends nothing, so the current role goes along hidden. */}
              {isMe && <input type="hidden" name="role" value={user.role} />}
              <RoleField value={s.values?.role ?? user.role} roles={roles} error={s.errors?.role} disabled={isMe} />
            </PanelSection>
          </>
        )}
      </PanelForm>
    </SidePanel>
  );
}

/**
 * "Set a new password · name" in the side panel on their page
 * (?panel=user-password): for when they forgot theirs. They are signed out
 * everywhere and use this one next time.
 */
export function PasswordPanel({ action, name }: { action: Action; name: string }) {
  const panel = useSidePanel("user-password");
  const saved = () => {
    toast("New password set. They are signed out everywhere; give them the password privately.");
    panel.close();
  };
  return (
    <SidePanel title={`Set a new password · ${name}`} description="For when they forgot theirs. They are signed out everywhere and use this one next time." onClose={() => panel.close()}>
      <PanelForm action={action} onSaved={saved} save="Set the new password" pending="Saving…">
        {(s) => (
          <PanelSection title="Password" first className="sm:grid-cols-1">
            <Field label="New password" htmlFor="new-password" error={s.errors?.password} hint={PASSWORD_HINT}>
              <Input id="new-password" name="password" type="text" autoComplete="new-password" spellCheck={false} {...invalid(s.errors?.password)} />
            </Field>
          </PanelSection>
        )}
      </PanelForm>
    </SidePanel>
  );
}
