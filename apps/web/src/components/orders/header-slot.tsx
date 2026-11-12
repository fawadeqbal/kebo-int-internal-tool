"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@kebo/ui";
import type { ActionState } from "@/lib/actions";
import { createPortal } from "react-dom";
import { useMounted } from "@/components/common/dialog";

/** Where a tab of the order puts its main button: the order's page header (board: "Record payment", "Set ready date"). */
export const ORDER_HEADER_SLOT = "order-header-slot";

/** Puts its children in the order's header (after the page loads); until then, nothing shows twice. */
export function HeaderSlot({ children }: { children: ReactNode }) {
  const mounted = useMounted();
  const at = mounted ? document.getElementById(ORDER_HEADER_SLOT) : null;
  return at ? createPortal(children, at) : null;
}

/** A one-tap action as the header's main button ("Mark arrived"): saves at once, shows a failure under it. */
export function HeaderTap({
  label,
  action,
  on,
  extra,
}: {
  label: string;
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  on: string;
  extra?: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="relative inline-flex">
      <Button
        variant="primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const form = new FormData();
            form.set("on", on);
            for (const [k, v] of Object.entries(extra ?? {})) form.set(k, v);
            const r = await action({}, form);
            if (r.ok) router.refresh();
            else setError(r.message ?? "Something went wrong. Please try again.");
          })
        }
      >
        <Check aria-hidden /> {pending ? "Saving…" : label}
      </Button>
      {error && (
        <span role="alert" className="absolute top-full right-0 mt-1 w-64 text-right text-xs text-bad">
          {error}
        </span>
      )}
    </span>
  );
}
