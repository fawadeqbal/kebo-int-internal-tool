import { Lock } from "lucide-react";
import { EmptyState, PageHeader } from "@kebo/ui";

/** A page the company's plan does not include. */
export function PlanOff({ title, what, crumbs }: { title: string; what: string; crumbs?: { label: string; href?: string }[] }) {
  return (
    <div>
      <PageHeader title={title} crumbs={crumbs} />
      <EmptyState
        icon={Lock}
        title="Not in your plan"
        description={`${what} is not part of your company's plan. Ask the platform admin to switch it on.`}
      />
    </div>
  );
}
