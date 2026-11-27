import Link from "next/link";
import { Card, CardBody, PageHeader, RULES, linkClass } from "@kebo/ui";
import { newCompanyData } from "./data";
import { NewCompanyForm } from "./form";
import { CouldNotLoad } from "@/components/common/could-not-load";

export const metadata = { title: "New company or demo" };

/** New company or demo as its own page (a new tab or a reload); from a button it opens as a window (@window/(.)companies/new). */
export default async function NewCompanyPage({ searchParams }: { searchParams: Promise<{ lead?: string; kind?: string }> }) {
  const { plans, lead, prefill, leadFailed } = await newCompanyData(await searchParams);
  return (
    <div className={RULES.page.column}>
      <PageHeader
        title="New company or demo"
        summary={
          lead ? (
            <>
              For{" "}
              <Link href={`/platform/leads/${lead.id}`} className={linkClass}>
                {lead.name} ({lead.companyName})
              </Link>
              . Their own space, with them as its tenant admin.
            </>
          ) : (
            "Its own space, with its own tenant admin who manages its people, roles and settings."
          )
        }
      />
      <Card>
        <CardBody>
          {leadFailed && <CouldNotLoad what={leadFailed} className="mb-4" />}
          <NewCompanyForm plans={plans} prefill={prefill} />
        </CardBody>
      </Card>
    </div>
  );
}
