"use client";

import { ConfirmDialog } from "@/components/common/dialog";
import { useRef, useState, useTransition } from "react";

import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";

import { buttonClass, cn } from "@kebo/ui";
import { toast } from "@kebo/ui/client";

import { FloatingMenu } from "@/components/common/floating";
import { WhatHappens } from "@/components/common/panel";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** A request's "More ▾": declined, no reply, still waiting, or remove it. */
export function RequestMore({
  name,
  status,
  setStatus,
  remove,
}: {
  name: string;
  status: string;
  setStatus: Action;
  remove: Action;
}) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: Action, values: Record<string, string>) => () => {
    setOpen(false);
    start(async () => {
      const form = new FormData();
      for (const [k, v] of Object.entries(values)) form.set(k, v);
      const r = await fn({}, form);
      if (!r.ok && r.message) toast(r.message);
      router.refresh();
    });
  };
  const item = "flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none";
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More for ${name}`}
        disabled={pending}
        // ⋯, the quiet end of a row (design "list pages" 18 Nov).
        className={buttonClass("ghost", "icon-sm", "text-text-2")}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal aria-hidden />
      </button>
      {open && (
        <FloatingMenu anchor={() => ref.current} onClose={() => setOpen(false)} label={`${name}: request`} width={220}>
          {status !== "declined" && (
            <button type="button" role="menuitem" className={item} onClick={run(setStatus, { status: "declined" })}>
              They declined
            </button>
          )}
          {status !== "no_reply" && status !== "quoted" && (
            <button type="button" role="menuitem" className={item} onClick={run(setStatus, { status: "no_reply" })}>
              No reply
            </button>
          )}
          {(status === "declined" || status === "no_reply") && (
            <button type="button" role="menuitem" className={item} onClick={run(setStatus, { status: "sent" })}>
              Still waiting
            </button>
          )}
          <span role="separator" className="my-1 block h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            className={cn(item, "text-bad")}
            onClick={() => {
              setOpen(false);
              setAsking(true);
            }}
          >
            Remove the request
          </button>
        </FloatingMenu>
      )}
      {asking && (
        <ConfirmDialog
          title={`Remove the request to ${name}?`}
          confirmLabel="Remove the request"
          cancelLabel="Keep it"
          danger
          busy={pending}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            run(remove, {})();
          }}
        >
          <WhatHappens lines={["The item leaves this inquiry. Nothing else changes.", `${name} stays in Partners.`]} />
        </ConfirmDialog>
      )}
    </>
  );
}
