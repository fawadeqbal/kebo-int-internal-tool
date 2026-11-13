"use client";

import type { ActionState } from "@/lib/actions";
import type { SatCheckView } from "@/lib/types-flow";
import { SatEditor } from "./flow-forms";
import { PanelBody } from "@/components/common/panel";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** The SAT points: Pass / Fail / N/A and a note each. */
export function SatEdit({ action, checks, suggested, locked }: { action: Action; checks: SatCheckView[]; suggested: string[]; locked: boolean }) {
  return (
    <PanelBody>
      {locked && <p className="mb-3 text-xs text-muted">Signed off: clear the sign-off date (Delivery · Edit) to reopen a point.</p>}
      <SatEditor action={action} checks={checks} suggested={suggested} locked={locked} />
    </PanelBody>
  );
}
