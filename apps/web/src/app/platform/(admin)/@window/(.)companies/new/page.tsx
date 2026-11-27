import { RouteWindow } from "@/components/common/route-window";
import { newCompanyData } from "../../../companies/new/data";
import { NewCompanyForm } from "../../../companies/new/form";
import { CouldNotLoad } from "@/components/common/could-not-load";

/** New company or demo, opened from a button: a window over the page you are on. */
export default async function NewCompanyWindow({ searchParams }: { searchParams: Promise<{ lead?: string; kind?: string }> }) {
  const { plans, lead, prefill, leadFailed } = await newCompanyData(await searchParams);
  return (
    <RouteWindow
      title="New company or demo"
      description={lead ? `For ${lead.name} (${lead.companyName}): their own space, with them as its tenant admin.` : "Its own space, with its own tenant admin who manages its people, roles and settings."}
      size="lg"
    >
      {leadFailed && <CouldNotLoad what={leadFailed} className="mb-4" />}
      <NewCompanyForm plans={plans} prefill={prefill} />
    </RouteWindow>
  );
}
