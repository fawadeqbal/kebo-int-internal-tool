import { Check, Minus } from "lucide-react";
import { PLAN_FEATURES, planFeatureName } from "@kebo/shared";
import { Badge, Card, CardBody, CardHeader, PageHeader } from "@kebo/ui";
import { platformApi } from "@/lib/api";
import { money } from "@/lib/format";
import type { Plan } from "@/lib/types-platform";
import { createPlanAction, deletePlanAction, updatePlanAction } from "@/app/platform/actions";
import { ActionButton } from "../companies/[id]/forms";
import { EditPlan, PlanForm } from "./forms";

export const metadata = { title: "Plans" };

/** What companies pay for: a price, limits on people and files, and the features included. */
export default async function PlansPage() {
  const plans = await platformApi.get<Plan[]>("/plans");
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Plans"
        description="Near a limit a company sees a warning; at the limit, adding people or files stops. Nothing is ever deleted."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((p) => (
          <Card key={p.id} className={p.isActive ? "" : "opacity-70"}>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  {p.name} {!p.isActive && <Badge tone="outline">Not offered</Badge>}
                </span>
              }
              description={`${money(p.priceMinor / 100, p.currency)} per ${p.period} · ${p.companies} compan${p.companies === 1 ? "y" : "ies"}`}
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
              {p.companies === 0 && (
                <div className="pt-1">
                  <ActionButton
                    action={deletePlanAction.bind(null, p.id)}
                    label="Delete"
                    variant="ghost"
                    confirm={`Delete the plan ${p.name}?`}
                  />
                </div>
              )}
            </CardBody>
            <EditPlan plan={p} action={updatePlanAction.bind(null, p.id)} />
          </Card>
        ))}
      </div>
      <Card className="max-w-2xl">
        <CardHeader title="New plan" />
        <CardBody>
          <PlanForm action={createPlanAction} submit="Make the plan" />
        </CardBody>
      </Card>
    </div>
  );
}
