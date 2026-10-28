import { Card, CardBody, PageHeader } from "@kebo/ui";
import { NewLeadForm } from "./form";

export const metadata = { title: "Add a client inquiry" };

export default function NewLeadPage() {
  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Add a client inquiry"
        description="Someone who asked by phone, WhatsApp or in person."
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
