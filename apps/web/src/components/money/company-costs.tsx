"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@kebo/ui";
import { repeatingAction } from "@/app/(app)/money/actions";
import { money } from "@/lib/format";
import { useTime } from "@/lib/time-client";
import type { RepeatingCosts } from "@/lib/types-money";
import { companyKind } from "./company-kinds";
import { ConfirmCost, type CostSetup } from "./cost-window";

type Waiting = RepeatingCosts["waiting"][number];

/** One cost that comes every month and is not in this month yet: Skip (this month only), or Confirm with what was paid. */
export function RepeatingRow({ w, setup }: { w: Waiting; setup: CostSetup }) {
  const { date } = useTime();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-[18px] py-3">
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{w.description}</span>
        <span className="block text-xs text-text-2">
          {companyKind(w.category)} · every month on day {w.day} · last time {money(w.last.amount, w.currency)} on {date(w.last.on)}
          {w.account ? ` from ${w.account.name}` : ""}
        </span>
        {error && <span className="block text-xs text-bad">{error}</span>}
      </span>
      <span className="flex items-center gap-2">
        <span className="mr-2 text-sm font-semibold tabular">{money(w.amount, w.currency)}</span>
        <Button
          size="sm"
          variant="secondary"
          className="h-8 px-2.5 text-md"
          disabled={busy}
          onClick={() =>
            start(async () => {
              const r = await repeatingAction(w.key, "skip");
              if (r.ok) router.refresh();
              else setError(r.message ?? "It could not be skipped.");
            })
          }
        >
          Skip
        </Button>
        <ConfirmCost
          setup={setup}
          sub={`${w.description} · every month on day ${w.day}`}
          // A proposed month is paid on its day once that day has come; before it, today.
          month={{ key: w.key, category: w.category, description: w.description, amount: w.amount, currency: w.currency, account: w.account, on: w.on <= setup.today ? w.on : setup.today }}
        />
      </span>
    </li>
  );
}

/** "Stop repeating" on a cost that comes every month: it is no longer proposed. Its past months stay. */
export function StopRepeating({ repeatKey }: { repeatKey: string }) {
  const [busy, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={busy}
      onClick={() =>
        start(async () => {
          const r = await repeatingAction(repeatKey, "stop");
          if (r.ok) router.refresh();
        })
      }
    >
      Stop repeating
    </Button>
  );
}
