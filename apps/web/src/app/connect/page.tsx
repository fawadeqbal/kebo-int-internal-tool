import { AuthShell } from "@/app/login/auth-shell";
import { checkPath, CheckForm, RecordTable, target } from "./parts";

export const metadata = { title: "Connect your domain" };

const MISTAKES = [
  [
    "The whole address as the name",
    "Writing staff.yourcompany.com as the name often makes staff.yourcompany.com.yourcompany.com. Write only staff.",
  ],
  ["Added in the wrong panel", "The record was saved where the domain was bought, but its nameservers point somewhere else."],
  ["Cloudflare's proxy on", "Set the record to DNS only (grey cloud). Behind the proxy our server cannot be seen."],
  ["An old record in the way", "An A record or another CNAME with the same name. Remove it first."],
] as const;

/**
 * connect.<BASE_DOMAIN> (claude/own-domains-admin-design.md): the address companies' own domains point to.
 * For whoever looks after a company's DNS: what the address is, the one record, the usual mistakes, and a
 * check of the domain they are connecting.
 */
export default async function ConnectPage() {
  return (
    <AuthShell wide subtitle="For the person who looks after your domain">
      <h1 className="text-2xl leading-8 font-bold tracking-tight">This address connects a company&apos;s own domain to RFQ Desk</h1>
      <p className="mt-2 text-sm text-text-2">
        If you were asked to add a record that points to <strong className="font-mono font-medium text-text">{target()}</strong>, you are in
        the right place. There is nothing to sign in to here: add the record where your domain is managed, then check it below.
      </p>

      <div className="mt-6">
        <CheckForm action={await checkPath()} />
      </div>

      <ol className="mt-7 flex flex-col gap-3 text-sm">
        <li>
          <strong>1. Find where your DNS is managed.</strong>{" "}
          <span className="text-text-2">Often where the domain was bought, but not always: the check tells you.</span>
        </li>
        <li>
          <strong>2. Add one record.</strong> <span className="text-text-2">A CNAME named with the first part of your address only:</span>
          <div className="mt-2">
            <RecordTable />
          </div>
        </li>
        <li>
          <strong>3. Check it here.</strong>{" "}
          <span className="text-text-2">
            Most records show within minutes, some within an hour. Once it is right, RFQ Desk connects it by itself within 10 minutes.
          </span>
        </li>
      </ol>

      <h2 className="mt-7 text-sm font-semibold">Mistakes we see most</h2>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {MISTAKES.map(([title, text]) => (
          <li key={title} className="rounded-lg bg-warn-soft px-3 py-2.5 text-md [overflow-wrap:anywhere]">
            <strong className="block text-warn">{title}</strong>
            {text}
          </li>
        ))}
      </ul>
    </AuthShell>
  );
}
