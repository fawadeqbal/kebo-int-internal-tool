import Link from "next/link";
import { Card, CardBody, PageHeader } from "@kebo/ui";
import { platformApi } from "@/lib/api";
import type { LeadDetail, Plan } from "@/lib/types-platform";
import { NewCompanyForm, type Prefill } from "./form";

export const metadata = { title: "New company or demo" };

export default async function NewCompanyPage({ searchParams }: { searchParams: Promise<{ lead?: string; kind?: string }> }) {
  const sp = await searchParams;
  const [plans, lead] = await Promise.all([
    platformApi.get<Plan[]>("/plans"),
    sp.lead ? platformApi.get<LeadDetail>(`/leads/${sp.lead}`).catch(() => null) : null,
  ]);
  const prefill: Prefill = {
    kind: sp.kind === "demo" ? "demo" : sp.kind === "client" ? "client" : lead ? "demo" : "client",
    name: lead?.companyName,
    adminName: lead?.name,
    adminEmail: lead?.email,
    leadId: lead?.id,
  };
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="New company or demo"
        description={
          lead ? (
            <>
              For{" "}
              <Link href={`/platform/leads/${lead.id}`} className="font-medium text-primary hover:underline">
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
          <NewCompanyForm plans={plans} prefill={prefill} />
        </CardBody>
      </Card>
    </div>
  );
}
