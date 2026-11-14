import type { OwnDomainView } from "@kebo/shared";
import { Card, CardBody, CardHeader, StatusBadge } from "@kebo/ui";
import { api } from "@/lib/api";
import { CheckDomain, ConnectDomain, CopyValue, RemoveDomain } from "./domain-forms";

export type DomainView = OwnDomainView & { enabled: boolean };
/** The company's own domain as the API has it (null: not offered here, or it cannot be read). */
export const domainView = () => api.get<DomainView>("/company/domain").catch(() => null);

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** "2 minutes ago", "3 hours ago", "just now". */
function ago(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} hour${hours === 1 ? "" : "s"} ago` : day(iso);
}

/** The one record that connects the domain: its type, its name, its value (with Copy), and where it is added. */
function Record({ view }: { view: DomainView }) {
  const r = view.record!;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] font-semibold">Add this record where {r.zone} is managed</p>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[420px] text-left text-[13px]">
          <thead className="bg-surface-2 text-xs text-text-2">
            <tr>
              <th className="px-3.5 py-2 font-semibold">Type</th>
              <th className="px-3.5 py-2 font-semibold">Name</th>
              <th className="px-3.5 py-2 font-semibold">Value</th>
              <th className="px-3.5 py-2">
                <span className="sr-only">Copy</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-3.5 py-2.5 font-semibold">{r.type}</td>
              <td className="px-3.5 py-2.5 font-mono">{r.name}</td>
              <td className="px-3.5 py-2.5 font-mono [overflow-wrap:anywhere]">{r.value}</td>
              <td className="px-2.5 py-1.5 text-right">
                <CopyValue value={r.value} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Company settings › Company address, the second card: the company keeps its address under ours, or
 * connects a domain it owns. Not connected; waiting for the record (the record to add, Check now);
 * connected; lost (the record went away: the team is back at our address until it returns).
 */
export async function DomainCard({ view }: { view: DomainView | null }) {
  if (!view?.enabled) return null;
  const { domain, status, ours } = view;
  const actions = !view.canChange ? undefined : !domain ? (
    <ConnectDomain ours={ours} />
  ) : (
    <>
      {status !== "connected" && <CheckDomain />}
      <RemoveDomain domain={domain} ours={ours} connected={status === "connected"} />
    </>
  );
  return (
    <Card className="mt-4">
      <CardHeader title="Your own domain" description="Use a domain you own instead of ours." className="max-sm:flex-row max-sm:gap-3" actions={actions} />
      <CardBody className="flex flex-col gap-4">
        {!domain ? (
          <div>
            <p className="text-xs font-medium tracking-wide text-muted uppercase">Now</p>
            <p className="mt-1 text-sm text-text-2">Not connected. Your team uses {ours}.</p>
          </div>
        ) : status === "connected" ? (
          <div>
            <p className="text-xs font-medium tracking-wide text-muted uppercase">Now</p>
            <p className="mt-1 flex flex-wrap items-center gap-2.5">
              <a href={`https://${domain}`} className="font-mono text-base font-medium text-primary hover:underline">
                {domain}
              </a>
              <StatusBadge meaning="ok">Connected</StatusBadge>
            </p>
            <p className="mt-1 text-xs text-text-2">{view.since ? `Since ${day(view.since)} · ` : ""}your team signs in here · links in emails go here</p>
          </div>
        ) : (
          <>
            <p className="flex flex-wrap items-center gap-2.5">
              <span className="font-mono text-base font-medium">{domain}</span>
              {status === "lost" ? <StatusBadge meaning="bad">Record not found</StatusBadge> : <StatusBadge meaning="warn">Waiting for the record</StatusBadge>}
            </p>
            <Record view={view} />
            {status === "lost" ? (
              <p className="text-xs text-bad">
                {view.lostAt ? `The record was there until ${day(view.lostAt)} and is gone. ` : "The record is gone. "}Your team uses {ours} until it is back.
              </p>
            ) : (
              <p className="text-xs text-text-2">
                {view.checkedAt ? `Checked ${ago(view.checkedAt)}: not found yet. ` : ""}We check every 10 minutes. A new record can take up to an hour to show.
              </p>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
