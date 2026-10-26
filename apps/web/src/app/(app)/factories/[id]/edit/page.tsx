import { PageHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { load, requirePermission } from "@/lib/session";
import type { FactoryDetail } from "@/lib/types-people";
import { saveFactoryAction } from "../../actions";
import { FactoryForm } from "../../factory-form";

export const metadata = { title: "Edit factory" };

export default async function EditFactoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("sourcing.manage");
  const f = await load(() => api.get<FactoryDetail>(`/factories/${id}`));
  return (
    <div className="max-w-3xl">
      <PageHeader
        backHref={`/factories/${f.id}`}
        backLabel={f.name}
        title={`Edit ${f.name}`}
        description="Changes apply to new prices and orders; past ones keep what was agreed."
      />
      <FactoryForm action={saveFactoryAction.bind(null, f.id)} factory={f} cancelHref={`/factories/${f.id}`} />
    </div>
  );
}
