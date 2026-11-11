import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { factoryOf } from "@/lib/party-data";
import { getPeople } from "@/lib/loaders";
import type { Person } from "@/lib/types";
import { DetailsCard } from "@/components/common/record";
import { RecordLanding } from "@/components/common/record-nav";
import { PerformanceCard } from "@/components/insights/performance";
import { saveFactoryAction } from "../actions";
import { FactoryPanel } from "../factory-form";

export const metadata = { title: "Supplier" };

/** Old ?tab= links, ?offers=all and the history panel → the tab that has them now. */
const TAB_OF: Record<string, string> = { prices: "offers", costs: "costs", making: "orders", history: "notes" };

/**
 * The supplier's Overview tab: Performance (Insights) and Details with ✎ Edit (the side panel), its main
 * contact among them. What it makes, its prices, costs and notes each have their own tab.
 */
export default async function FactoryOverview({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const old = sp.tab ? TAB_OF[sp.tab] : sp.offers === "all" ? "offers" : sp.panel === "history" ? "notes" : undefined;
  if (old) redirect(`/factories/${id}/${old}`);
  const me = await requirePermission("sourcing.manage");
  const editing = sp.panel === "edit-factory";
  const [f, people] = await Promise.all([factoryOf(id), editing ? getPeople().catch(() => [] as Person[]) : ([] as Person[])]);

  return (
    <div className="flex flex-col gap-5">
      <RecordLanding />
      <PerformanceCard kind="factory" id={f.id} me={me} balances={false} />
      <DetailsCard
        flash={sp.saved === f.id}
        edit={{ panel: "edit-factory", id: f.id, label: `Edit ${f.name}` }}
        items={[
          { label: "Contact person", value: f.contactPerson },
          {
            label: "Phone",
            value: f.phone && (
              <a href={`tel:${f.phone}`} className="hover:text-primary hover:underline">
                {f.phone}
              </a>
            ),
          },
          { label: "WeChat", value: f.wechat },
          {
            label: "Email",
            value: f.email && (
              <a href={`mailto:${f.email}`} className="break-all hover:text-primary hover:underline">
                {f.email}
              </a>
            ),
          },
          { label: "Looked after by", value: f.owner?.name },
          { label: "Address", value: f.address && <span className="whitespace-pre-line">{f.address}</span> },
          { label: "Bank details", value: f.bankDetails && <span className="whitespace-pre-line">{f.bankDetails}</span>, wide: true },
          { label: "Notes", value: f.notes && <span className="whitespace-pre-line">{f.notes}</span>, wide: true, optional: true },
        ]}
      />
      {editing && <FactoryPanel action={saveFactoryAction.bind(null, f.id)} factory={f} people={people} meId={me.id} onRecord />}
    </div>
  );
}
