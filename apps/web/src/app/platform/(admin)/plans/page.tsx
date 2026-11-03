import { Check, Minus, Plus } from "lucide-react";
import { PLAN_FEATURES, planFeatureName } from "@kebo/shared";
import { Card, CardBody, CardHeader, PageHeader, StatusBadge } from "@kebo/ui";
import { platformApi } from "@/lib/api";
import { money } from "@/lib/format";
import type { Plan } from "@/lib/types-platform";
import { createPlanAction, deletePlanAction, updatePlanAction } from "@/app/platform/actions";
import { OpenPanelButton } from "@/components/common/panel";
import { PlanActions, PlanPanels } from "./forms";

export const metadata = { title: "Plans" };

/**
 * What companies pay for: a price, limits on people and files, and the features
 * included. Each plan is a card with ✎ Edit (side panel) and ⋯ Delete; "New
 * plan" is the page's one primary and opens the same panel.
 */
export default async function PlansPage() {
  const plans = await platformApi.get<Plan[]>("/plans");
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Plans"
        summary="Near a limit a company sees a warning; at the limit, adding people or files stops. Nothing is ever deleted."
        primary={
          <OpenPanelButton panel="new-plan" variant="primary" label="New plan">
            <Plus aria-hidden /> New plan
          </OpenPanelButton>
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((p) => (
          <Card key={p.id} className={p.isActive ? "" : "opacity-70"}>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  {p.name} {!p.isActive && <StatusBadge meaning="neutral">Not offered</StatusBadge>}
                </span>
              }
              description={`${money(p.priceMinor / 100, p.currency)} per ${p.period} · ${p.companies} compan${p.companies === 1 ? "y" : "ies"}`}
              className="max-sm:flex-row max-sm:gap-3"
              actions={<PlanActions plan={p} remove={p.companies === 0 ? deletePlanAction.bind(null, p.id) : undefined} />}
            />
            <CardBody className="flex flex-col gap-2 text-sm">
              {p.description && <p className="text-text-2">{p.description}</p>}
              <p>
                {p.maxUsers ? `${p.maxUsers} people` : "Any number of people"} ·{" "}
                {p.maxStorageMb ? `${Math.round((p.maxStorageMb / 1024) * 10) / 10} GB of files` : "no file limit"}
              </p>
              <ul className="flex flex-col gap-1">
                {Object.keys(PLAN_FEATURES).map((k) => (
                  <li
                    key={k}
                    className={
                      p.features.includes(k)
                        ? "flex items-center gap-2"
                        : "flex items-center gap-2 text-muted line-through decoration-line-strong"
                    }
                  >
                    {p.features.includes(k) ? (
                      <Check className="size-4 shrink-0 text-ok" aria-label="Included" />
                    ) : (
                      <Minus className="size-4 shrink-0" aria-label="Not included" />
                    )}
                    {planFeatureName(k)}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ))}
      </div>
      <PlanPanels plans={plans} create={createPlanAction} update={Object.fromEntries(plans.map((p) => [p.id, updatePlanAction.bind(null, p.id)]))} />
    </div>
  );
}
