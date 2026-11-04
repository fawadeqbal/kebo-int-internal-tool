"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, Copy, FileText } from "lucide-react";
import type { LedgerPartyKind } from "@kebo/shared";
import { Button, buttonClass, cn } from "@kebo/ui";
import { toast } from "@kebo/ui/client";
import { issueStatementAction } from "@/app/(app)/finance/ledger/actions";

/**
 * "Statement" in a customer's or factory's header: the statement of account from 1 January to today, given its
 * number and opened to print, download or share (as on the party's ledger).
 */
export function StatementButton({ kind, id, from, to, back, label = "Statement", variant = "ghost" }: { kind: LedgerPartyKind; id: string; from: string; to: string; back: string; label?: string; variant?: "ghost" | "secondary" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const s = await issueStatementAction(kind, id, { from, to, back });
          if (!s.ok || !s.view) return void toast(s.message ?? "Something went wrong. Try again.");
          router.push(s.view);
        })
      }
    >
      {variant === "secondary" && <FileText aria-hidden />}
      {pending ? "Preparing…" : label}
    </Button>
  );
}

/** Copies a text (a WeChat ID, bank details) and says so for 2 seconds. */
export function CopyButton({ text, label, done = "Copied", className, size = "sm", variant = "secondary" }: { text: string; label: string; done?: string; className?: string; size?: "xs" | "sm"; variant?: "secondary" | "ghost" }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={cn(buttonClass(variant, size), className)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          toast("Copying is blocked here. Select the text instead.");
        }
      }}
    >
      {copied ? <Check aria-hidden /> : variant === "ghost" ? <Copy aria-hidden /> : null}
      <span aria-live="polite">{copied ? done : label}</span>
    </button>
  );
}

/**
 * Old links to a section of the page (#money, #notes…) open the tab that holds it now. Only when no ?tab= is
 * given; the hash is dropped.
 */
export function HashToTab({ map }: { map: Record<string, string> }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash || sp.get("tab")) return;
    const tab = map[hash];
    if (!tab) return;
    const q = new URLSearchParams(sp.toString());
    if (tab !== "overview") q.set("tab", tab);
    router.replace(`${path}${q.size ? `?${q}` : ""}`, { scroll: false });
  }, [map, path, router, sp]);
  return null;
}
