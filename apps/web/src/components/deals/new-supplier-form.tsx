"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronRight } from "lucide-react";
import { Button, capsClass, cn, Field, Input, Notice, Textarea, linkClass } from "@kebo/ui";
import type { SupplierOption } from "@/lib/types-deals";
import type { QuickSupplier, QuickSupplierResult } from "@/app/(app)/inquiries/[id]/sourcing/actions";
import { isFailed, type Failed } from "@/lib/failed";

/** Enter in these small inputs must not save the whole offer. */
const noSubmit = (e: KeyboardEvent) => {
  if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") e.preventDefault();
};

/**
 * "+ New supplier" from the offer's picker, as "+ New customer" is on an inquiry: the Supplier step becomes this
 * form, with what was typed as the name. The name and the person we deal with and how to reach them; More holds
 * the address, bank details and notes. A supplier with a similar name shows above it with Use this one. The
 * window's bottom bar has Back to search and Add and use; the supplier is added at once, looked after by whoever
 * adds it, and chosen for the offer.
 */
export function NewSupplierForm({
  initialName,
  add,
  search,
  onUse,
  onReady,
  onBusy,
}: {
  initialName: string;
  add: (v: QuickSupplier) => Promise<QuickSupplierResult>;
  search: (q: string) => Promise<SupplierOption[] | Failed>;
  onUse: (f: SupplierOption) => void;
  /** Gives the window's Add and use its way in. */
  onReady: (api: { save: () => void }) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [q, setQ] = useState<QuickSupplier>({ name: initialName, contactPerson: "", phone: "", wechat: "", email: "", address: "", bankDetails: "", notes: "" });
  const [more, setMore] = useState(false);
  const [result, setResult] = useState<Extract<QuickSupplierResult, { ok: false }> | null>(null);
  const [found, setFound] = useState<{ name: string; list: SupplierOption[]; failed?: boolean }>({ name: "", list: [] });
  const set = (k: keyof QuickSupplier, value: string) => setQ((s) => ({ ...s, [k]: value }));
  const err = (k: string) => result?.errors?.[k]?.[0];

  // A supplier with a similar name is shown while typing (nothing is stopped: a new one can still be added).
  const name = q.name.trim();
  useEffect(() => {
    if (name.length < 3) return;
    let live = true;
    const t = setTimeout(async () => {
      const list = await search(name);
      const words = name
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);
      if (live) setFound(isFailed(list) ? { name, list: [], failed: true } : { name, list: list.filter((f) => words.some((w) => f.name.toLowerCase().includes(w))).slice(0, 2) });
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [name, search]);
  const similar = name.length >= 3 && found.name === name ? found.list : [];
  // The look for a similar name failed: said, so "none shown" is not taken for "none there".
  const checkFailed = name.length >= 3 && found.name === name && !!found.failed;

  const save = async () => {
    onBusy(true);
    const r = await add(q);
    onBusy(false);
    if (r.ok) onUse(r.factory);
    else {
      setResult(r);
      // A refused value under More opens it, so its message is in view.
      if (r.errors && ["address", "bankDetails", "notes"].some((k) => r.errors?.[k])) setMore(true);
    }
  };
  const saveNow = useRef(save);
  useEffect(() => {
    saveNow.current = save;
  });
  useEffect(() => {
    onReady({ save: () => void saveNow.current() });
  }, [onReady]);

  return (
    <section aria-label="New supplier" className="flex flex-col gap-4" onKeyDown={noSubmit}>
      <h4 className="-mb-1 text-base font-bold">New supplier</h4>
      {checkFailed && <p className="text-xs text-bad">Could not look for a supplier with a similar name: check Suppliers before adding one.</p>}
      {similar.length > 0 && (
        <Notice tone="todo">
          <div className="flex flex-col gap-2">
            {similar.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="min-w-0 flex-1">
                  Already a supplier? <b className="font-semibold">{f.name}</b>
                  {f.contactPerson && <span className="text-text-2"> · {f.contactPerson}</span>}
                </span>
                <Button size="sm" onClick={() => onUse(f)}>
                  Use this one
                </Button>
              </div>
            ))}
          </div>
        </Notice>
      )}
      {result && !Object.keys(result.errors ?? {}).length && <p className="text-sm text-bad">{result.message}</p>}
      <Field label="Name" htmlFor="qs-name" required error={err("name")}>
        <Input id="qs-name" value={q.name} onChange={(e) => set("name", e.target.value)} maxLength={200} autoFocus />
      </Field>
      <p className={cn(capsClass, "-mb-1")}>Who we deal with</p>
      <div className="grid gap-x-4 gap-y-3.5 md:grid-cols-2">
        <Field label="Contact person" htmlFor="qs-contact" optional error={err("contactPerson")}>
          <Input id="qs-contact" value={q.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} maxLength={120} />
        </Field>
        <Field label="Email" htmlFor="qs-email" optional error={err("email")}>
          <Input id="qs-email" type="email" value={q.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label="Phone" htmlFor="qs-phone" optional error={err("phone")}>
          <Input id="qs-phone" type="tel" value={q.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="WeChat" htmlFor="qs-wechat" optional error={err("wechat")}>
          <Input id="qs-wechat" value={q.wechat} onChange={(e) => set("wechat", e.target.value)} maxLength={80} />
        </Field>
      </div>
      <button
        type="button"
        aria-expanded={more}
        onClick={() => setMore((m) => !m)}
        className={cn(linkClass, "flex items-center gap-1.5 self-start text-sm")}
      >
        <ChevronRight aria-hidden className={cn("size-4 transition-transform", more && "rotate-90")} /> More: address, bank details, notes
      </button>
      {more && (
        <div className="grid gap-x-4 gap-y-3.5">
          <Field label="Address" htmlFor="qs-address" optional error={err("address")} hint="End it with the city: the supplier list shows and filters by it">
            <Input id="qs-address" value={q.address} onChange={(e) => set("address", e.target.value)} maxLength={500} />
          </Field>
          <Field label="Bank details" htmlFor="qs-bank" optional error={err("bankDetails")}>
            <Textarea id="qs-bank" rows={3} value={q.bankDetails} onChange={(e) => set("bankDetails", e.target.value)} maxLength={1000} />
          </Field>
          <Field label="Notes" htmlFor="qs-notes" optional error={err("notes")}>
            <Textarea id="qs-notes" rows={2} value={q.notes} onChange={(e) => set("notes", e.target.value)} maxLength={5000} />
          </Field>
        </div>
      )}
    </section>
  );
}
