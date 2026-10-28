"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Alert, Field, Input } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { changeAddressAction, checkAddressAction } from "./actions";
import type { AddressView } from "./types";

/** A new short name, checked as it is typed: free, taken or not allowed. */
export function AddressForm({ view, disabled }: { view: AddressView; disabled: boolean }) {
  const [slug, setSlug] = useState("");
  const [check, setCheck] = useState<AddressView["check"]>(null);
  const [busy, setBusy] = useState(false);
  const wanted = slug.trim().toLowerCase();

  useEffect(() => {
    if (!wanted || wanted === view.slug) return;
    let live = true;
    const t = setTimeout(async () => {
      setBusy(true);
      const r = await checkAddressAction(wanted);
      if (live) {
        setCheck(r);
        setBusy(false);
      }
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [wanted, view.slug]);

  const shown = wanted && check?.slug === wanted ? check : null;
  const free = !!shown && !shown.problem;
  return (
    <ActionForm action={changeAddressAction} className="flex flex-col gap-4">
      <Field label="New address" htmlFor="slug" hint="3 to 30 characters: small letters, numbers and dashes.">
        <div className="flex items-center gap-2">
          <Input
            id="slug"
            name="slug"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
              setCheck(null);
            }}
            maxLength={30}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            className="max-w-56"
            aria-describedby="slug-check"
          />
          <span className="text-sm text-muted">.{view.baseDomain}</span>
        </div>
      </Field>
      <p id="slug-check" aria-live="polite" className="-mt-2 min-h-5 text-sm">
        {wanted && wanted === view.slug ? (
          <span className="text-muted">This is the address now.</span>
        ) : busy ? (
          <span className="text-muted">Checking…</span>
        ) : shown ? (
          shown.problem ? (
            <span className="inline-flex items-center gap-1.5 text-bad">
              <XCircle className="size-4" aria-hidden /> {shown.problem}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-ok">
              <CheckCircle2 className="size-4" aria-hidden /> {shown.url.replace(/^https:\/\//, "")} is available
            </span>
          )
        ) : null}
      </p>
      {free && (
        <Alert tone="info">
          Everyone signs in again at the new address. The old one keeps sending people there for 30 days (bookmarks, emails, the phone app
          keep working), and only then becomes free for others. The address can change again after 30 days.
        </Alert>
      )}
      <div>
        <SubmitButton pendingText="Changing…" disabled={disabled || !free}>
          Change the address
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
