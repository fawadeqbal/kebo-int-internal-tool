import { PageHeader } from "@kebo/ui";
import { requirePermission } from "@/lib/session";
import { api } from "@/lib/api";
import type { Person } from "@/lib/types";
import { saveFactoryAction } from "../actions";
import { FactoryForm } from "../factory-form";

export const metadata = { title: "New factory" };

export default async function NewFactoryPage() {
  const me = await requirePermission("sourcing.manage");
  const people = await api.get<Person[]>("/users/people");
  return (
    <div className="max-w-3xl">
      <PageHeader
        backHref="/factories"
        backLabel="Factories"
        title="New factory"
        description="Only the name is needed now; add the rest when you have it."
      />
      <FactoryForm action={saveFactoryAction.bind(null, null)} factory={null} cancelHref="/factories" people={people} meId={me.id} />
    </div>
  );
}
