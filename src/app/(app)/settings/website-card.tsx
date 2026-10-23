import { Card, CardBody, CardHeader } from "@/components/ui";
import { FIELD_NAMES, websiteSnippet } from "@/modules/inquiries/snippet";
import { CopyButton } from "./copy-button";

/** Shows the web designer exactly how to connect the website's RFQ form. */
export function WebsiteFormCard({ appUrl }: { appUrl: string }) {
  const endpoint = `${appUrl.replace(/\/$/, "")}/api/public/inquiries`;
  const snippet = websiteSnippet(appUrl);
  return (
    <Card className="max-w-4xl">
      <CardHeader
        title="Website form (keboint.com)"
        description="RFQs from the website form arrive here as Pending inquiries, and the emails above are notified."
      />
      <CardBody className="flex flex-col gap-5 text-sm">
        <ol className="list-decimal space-y-3 pl-5 text-text-2 marker:text-muted">
          <li>
            Make sure each field in the website form has these <code>name</code> values (other common names also work):
            <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:max-w-md">
              {FIELD_NAMES.map(([label, name]) => (
                <div key={name} className="contents">
                  <span className="text-muted">{label}</span>
                  <code>{name}</code>
                </div>
              ))}
            </div>
          </li>
          <li>
            Paste this script into the website, just before <code>&lt;/body&gt;</code>:
            <div className="relative mt-2">
              <pre className="max-h-72 overflow-auto rounded-lg border border-line bg-surface-2 p-3 pr-20 font-mono text-[11px] leading-relaxed text-text-2">{snippet}</pre>
              <div className="absolute right-2 top-2">
                <CopyButton text={snippet} />
              </div>
            </div>
          </li>
          <li>
            Without JavaScript, the form can also post directly: <code>&lt;form action=&quot;{endpoint}&quot; method=&quot;POST&quot;&gt;</code> — visitors then see a thank-you page with their reference number.
          </li>
        </ol>
        <p className="text-muted">
          Allowed website addresses are set on the server with <code>PUBLIC_FORM_ORIGINS</code> (now: {process.env.PUBLIC_FORM_ORIGINS ?? "https://keboint.com, https://www.keboint.com"}).
        </p>
      </CardBody>
    </Card>
  );
}
