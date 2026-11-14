"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Plus, RefreshCw } from "lucide-react";
import { Button, Field, Input } from "@kebo/ui";
import { SubmitButton, toast } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { ConfirmDialog } from "@/components/common/dialog";
import { PANEL_FORM, PanelActions, PanelBody, PanelKeys, SidePanel, useClosePanel, useSidePanel, WhatHappens } from "@/components/common/panel";
import { checkDomainAction, connectDomainAction, removeDomainAction } from "./actions";

/** "+ Connect a domain" in the card's header, and the window it opens (?panel=own-domain). */
export function ConnectDomain({ ours }: { ours: string }) {
  const panel = useSidePanel("own-domain");
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => panel.openPanel()}>
        <Plus aria-hidden /> Connect a domain
      </Button>
      {panel.open && (
        <SidePanel title="Connect your own domain" description="A part of a domain you own, like erp.yourcompany.com" onClose={() => panel.close()}>
          <PanelBody>
            <ConnectForm ours={ours} onSaved={() => panel.close()} />
          </PanelBody>
        </SidePanel>
      )}
    </>
  );
}

function ConnectForm({ ours, onSaved }: { ours: string; onSaved: () => void }) {
  const close = useClosePanel();
  const [domain, setDomain] = useState("");
  const shown = domain.trim() || "Your domain";
  return (
    <ActionForm action={connectDomainAction} className={PANEL_FORM} showSuccess={false} onDone={onSaved}>
      {(s) => (
        <>
          <Field label="Domain" htmlFor="own-domain" error={s.errors?.domain ?? (s.ok === false && s.message ? [s.message] : undefined)}>
            <Input
              id="own-domain"
              name="domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value.toLowerCase().replace(/\s/g, ""))}
              placeholder="erp.yourcompany.com"
              maxLength={253}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </Field>
          <WhatHappens
            lines={[
              "You add one record where your domain is managed",
              <>
                When we find it, <strong>{shown}</strong> opens your Kebo ERP
              </>,
              <>
                <strong>{ours}</strong> keeps working and sends people on
              </>,
              "Everyone signs in once more on the new address",
            ]}
          />
          <PanelActions>
            <SubmitButton pendingText="Checking…">Continue</SubmitButton>
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

/** "Check now": looks the record up again and says what was found. */
export function CheckDomain() {
  return (
    <ActionForm action={checkDomainAction}>
      <SubmitButton size="sm" pendingText="Checking…">
        <RefreshCw aria-hidden /> Check now
      </SubmitButton>
    </ActionForm>
  );
}

/** "Remove", after a question: the team goes back to the address under ours. */
export function RemoveDomain({ domain, ours, connected }: { domain: string; ours: string; connected: boolean }) {
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const remove = () =>
    start(async () => {
      const r = await removeDomainAction({}, new FormData());
      setAsking(false);
      toast(r.message ?? (r.ok ? "Domain removed." : "Could not remove the domain."));
      if (r.ok) router.refresh();
    });
  return (
    <>
      <Button size="sm" variant="danger-ghost" onClick={() => setAsking(true)}>
        Remove
      </Button>
      {asking && (
        <ConfirmDialog title={`Remove ${domain}?`} confirmLabel="Remove" danger busy={pending} onCancel={() => setAsking(false)} onConfirm={remove}>
          {connected ? (
            <>
              Your team goes back to <strong>{ours}</strong>. Everyone signs in once more. Links already sent with {domain} stop working.
            </>
          ) : (
            <>
              Your team stays at <strong>{ours}</strong>.
            </>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}

/** Copies a record's value. */
export function CopyValue({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      aria-label={`Copy ${value}`}
      onClick={() =>
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        })
      }
    >
      {done ? <Check aria-hidden /> : <Copy aria-hidden />} {done ? "Copied" : "Copy"}
    </Button>
  );
}
