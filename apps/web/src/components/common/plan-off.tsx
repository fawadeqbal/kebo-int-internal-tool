import { Lock } from "lucide-react";
import { EmptyState, PageHeader } from "@kebo/ui";

/** A page the company's plan does not include. */
export function PlanOff({ title, what }: { title: string; what: string }) {
  return (
    <div>
      <PageHeader title={title} />
      <EmptyState
        icon={Lock}
        title="Not in your plan"
        description={`${what} is not part of your company's plan. Ask the platform admin to switch it on.`}
      />
    </div>
  );
}
