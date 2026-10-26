import { PageHeader } from "@kebo/ui";
import { requirePermission } from "@/lib/session";
import { saveFactoryAction } from "../actions";
import { FactoryForm } from "../factory-form";

export const metadata = { title: "New factory" };

export default async function NewFactoryPage() {
  await requirePermission("sourcing.manage");
  return (
    <div className="max-w-3xl">
      <PageHeader backHref="/factories" backLabel="Factories" title="New factory" description="Only the name is needed now; add the rest when you have it." />
      <FactoryForm action={saveFactoryAction.bind(null, null)} factory={null} cancelHref="/factories" />
    </div>
  );
}
