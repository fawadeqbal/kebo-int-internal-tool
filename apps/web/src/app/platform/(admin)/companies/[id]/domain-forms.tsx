"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Plus, RefreshCw } from "lucide-react";
import { Button, Field, Input } from "@kebo/ui";
import { SubmitButton, toast } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { ConfirmDialog } from "@/components/common/dialog";
import { PANEL_FORM, PanelBody, PanelKeys, SidePanel, useSidePanel, WhatHappens, WindowFooter } from "@/components/common/panel";
import { platformCheckDomainAction, platformConnectDomainAction, platformRemoveDomainAction } from "./domain-actions";

/** "Check now" for the platform admin: the company's domain is looked up again on the spot. */
export function PlatformCheckDomain({ id }: { id: string }) {
  return (
    <ActionForm action={platformCheckDomainAction.bind(null, id)}>
      <SubmitButton size="sm" variant="secondary" pendingText="Checking…">
        <RefreshCw aria-hidden /> Check now
      </SubmitButton>
    </ActionForm>
  );
}

/** "+ Add their domain" and its window (?panel=company-domain): for a client who asked us to set it up. */
export function PlatformConnectDomain({ id, name, ours }: { id: string; name: string; ours: string }) {
  const panel = useSidePanel("company-domain");
  const [domain, setDomain] = useState("");
  const shown = domain.trim() || "their domain";
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => panel.openPanel()}>
        <Plus aria-hidden /> Add their domain
      </Button>
      {panel.open && (
        <SidePanel
          title="Add their own domain"
          description={`${name} · a part of a domain they own, like staff.theircompany.com`}
          onClose={() => panel.close()}
        >
          <PanelBody>
            <ActionForm
              action={platformConnectDomainAction.bind(null, id)}
              className={PANEL_FORM}
              showSuccess={false}
              onDone={() => panel.close()}
            >
              {(s) => (
                <>
                  <Field
                    label="Domain"
                    htmlFor="company-domain"
                    error={s.errors?.domain ?? (s.ok === false && s.message ? [s.message] : undefined)}
                  >
                    <Input
                      id="company-domain"
                      name="domain"
                      value={domain}
                      onChange={(e) => setDomain(e.target.value.toLowerCase().replace(/\s/g, ""))}
                      maxLength={253}
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      required
                    />
                  </Field>
                  <WhatHappens
                    lines={[
                      "They add one record where their domain is managed",
                      <>
                        When we find it, <strong>{shown}</strong> opens their RFQ Desk
                      </>,
                      <>
                        <strong>{ours}</strong> keeps working and sends people on
                      </>,
                      "Written in their history",
                    ]}
                  />
                  <WindowFooter>
                    <SubmitButton pendingText="Checking…">Add and check</SubmitButton>
                    <PanelKeys />
                  </WindowFooter>
                </>
              )}
            </ActionForm>
          </PanelBody>
        </SidePanel>
      )}
    </>
  );
}

/** "Remove domain", after a question: the company's people go back to its address under ours. */
export function PlatformRemoveDomain({ id, domain, ours, connected }: { id: string; domain: string; ours: string; connected: boolean }) {
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const remove = () =>
    start(async () => {
      const r = await platformRemoveDomainAction(id);
      setAsking(false);
      toast({ ...(r.ok ? {} : { kind: "fail" as const }), message: r.message ?? (r.ok ? "Domain removed." : "Could not remove the domain.") });
      if (r.ok) router.refresh();
    });
  return (
    <>
      <Button size="sm" variant="danger-ghost" onClick={() => setAsking(true)}>
        Remove domain
      </Button>
      {asking && (
        <ConfirmDialog
          title={`Remove ${domain}?`}
          confirmLabel="Remove"
          danger
          busy={pending}
          onCancel={() => setAsking(false)}
          onConfirm={remove}
        >
          {connected ? (
            <>
              Their people go back to <strong>{ours}</strong> and sign in once more. Links already sent with {domain} stop working.
            </>
          ) : (
            <>
              They stay at <strong>{ours}</strong>.
            </>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}

/** Copies a text (the record, or the message for the client) and says so. */
export function CopyText({ text, label, done: doneLabel = "Copied" }: { text: string; label: string; done?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() =>
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        })
      }
    >
      {done ? <Check aria-hidden /> : <Copy aria-hidden />} {done ? doneLabel : label}
    </Button>
  );
}
