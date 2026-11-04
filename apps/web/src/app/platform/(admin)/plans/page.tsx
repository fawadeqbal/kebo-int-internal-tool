import Link from "next/link";
import { Plus } from "lucide-react";
import { PLAN_FEATURE_KEYS, planFeatureName } from "@kebo/shared";
import { Card, DataRow, EmptyState, PageHeader, PhoneList, PhoneRow, StatusBadge, Td, Th, THead } from "@kebo/ui";
import { platformApi } from "@/lib/api";
import { money } from "@/lib/format";
import type { Plan } from "@/lib/types-platform";
import { createPlanAction, deletePlanAction, updatePlanAction } from "@/app/platform/actions";
import { DataTable } from "@/components/common/data-table";
import { RowMenu, type MenuEntry } from "@/components/common/more-menu";
import { OpenPanelButton } from "@/components/common/panel";
import { PlanPanels } from "./forms";

export const metadata = { title: "Plans" };

const gb = (mb: number) => `${Math.round((mb / 1024) * 10) / 10} GB`;
const price = (p: Plan) => (p.priceMinor ? `${money(p.priceMinor / 100, p.currency)} a ${p.period}` : "Free");
const limits = (p: Plan) =>
  `${p.maxUsers ? `${p.maxUsers} people` : "any number of people"} · ${p.maxStorageMb ? gb(p.maxStorageMb) : "no file limit"}`;
const modules = (p: Plan) => {
  const off = PLAN_FEATURE_KEYS.filter((f) => !p.features.includes(f));
  if (!off.length) return "everything";
  if (off.length <= 3) return `all but ${off.map(planFeatureName).join(", ")}`;
  return `${p.features.length} of ${PLAN_FEATURE_KEYS.length} modules`;
};
const editHref = (p: Plan) => `/platform/plans?panel=edit-plan&id=${p.id}`;

/**
 * What companies can buy (design system: List frame): each plan's price,
 * limits, modules and how many companies are on it. A row opens the plan in
 * the side panel to change it; ⋯ has Edit and Delete (only for a plan no
 * company uses). "New plan" is the page's one primary and opens the same panel.
 */
export default async function PlansPage() {
  const plans = await platformApi.get<Plan[]>("/plans");
  const menu = (p: Plan): MenuEntry[] => [
    { label: "Edit", panel: "edit-plan", id: p.id },
    ...(p.companies === 0
      ? [
          { separator: true } as const,
          {
            label: "Delete…",
            danger: true as const,
            confirm: { title: `Delete the plan ${p.name}?`, body: "No company uses it.", confirmLabel: "Delete the plan" },
            action: deletePlanAction.bind(null, p.id),
          },
        ]
      : []),
  ];
  return (
    <div>
      <PageHeader
        title="Plans"
        summary="What companies can buy · click a plan to change it"
        primary={
          <OpenPanelButton panel="new-plan" variant="primary" label="New plan">
            <Plus aria-hidden /> New plan
          </OpenPanelButton>
        }
      />
      <Card className="overflow-clip p-0">
        {plans.length === 0 ? (
          <EmptyState
            framed
            title="No plans yet"
            description="A plan sets a price, limits on people and files, and the modules a company gets. Use New plan above."
          />
        ) : (
          <>
            <PhoneList label="Plans">
              {plans.map((p) => (
                <PhoneRow
                  key={p.id}
                  href={editHref(p)}
                  title={p.name}
                  line={`${price(p)} · ${limits(p)}`}
                  status={!p.isActive ? <StatusBadge meaning="neutral">Not offered</StatusBadge> : undefined}
                  figure={`${p.companies} ${p.companies === 1 ? "company" : "companies"}`}
                />
              ))}
            </PhoneList>
            <DataTable label="Plans" className="max-sm:hidden">
              <THead>
                <tr>
                  <Th>Plan</Th>
                  <Th>Price</Th>
                  <Th>Limits</Th>
                  <Th>Modules</Th>
                  <Th className="text-right">Companies</Th>
                  <Th className="w-12">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </THead>
              <tbody>
                {plans.map((p) => (
                  <DataRow key={p.id} href={editHref(p)} className={p.isActive ? "" : "text-text-2"}>
                    <Td>
                      <Link
                        href={editHref(p)}
                        scroll={false}
                        className="font-semibold hover:text-primary"
                        aria-label={`Edit the plan ${p.name}`}
                      >
                        {p.name}
                      </Link>
                      {!p.isActive && (
                        <StatusBadge meaning="neutral" className="ml-2">
                          Not offered
                        </StatusBadge>
                      )}
                      {p.description && <span className="block text-xs text-text-2">{p.description}</span>}
                    </Td>
                    <Td className="text-sm whitespace-nowrap">{price(p)}</Td>
                    <Td className="text-sm">{limits(p)}</Td>
                    <Td className="text-sm text-text-2">{modules(p)}</Td>
                    <Td className="text-right tabular">{p.companies}</Td>
                    <Td className="text-right">
                      <RowMenu label={`Actions for the plan ${p.name}`} items={menu(p)} />
                    </Td>
                  </DataRow>
                ))}
              </tbody>
            </DataTable>
          </>
        )}
      </Card>
      <PlanPanels
        plans={plans}
        create={createPlanAction}
        update={Object.fromEntries(plans.map((p) => [p.id, updatePlanAction.bind(null, p.id)]))}
      />
    </div>
  );
}
