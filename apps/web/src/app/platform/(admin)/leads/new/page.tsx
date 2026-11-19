import { Card, CardBody, PageHeader, RULES } from "@kebo/ui";
import { NewLeadForm } from "./form";

export const metadata = { title: "New client inquiry" };

export default function NewLeadPage() {
  return (
    <div className={RULES.page.column}>
      <PageHeader
        title="New client inquiry"
        backHref="/platform/leads"
        backLabel="Client inquiries"
      />
      <Card>
        <CardBody>
          <NewLeadForm />
        </CardBody>
      </Card>
    </div>
  );
}
