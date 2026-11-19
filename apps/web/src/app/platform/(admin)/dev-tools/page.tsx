import type { DevCompaniesView, DevDataView, DevJobsView, DevOverview, DevSecurityView, DevServicesView, DevSpeedView, DevTab } from "@kebo/shared";
import { LinkTabs, PageHeader } from "@kebo/ui";
import { platformApi } from "@/lib/api";
import { currentZone } from "@/lib/format";
import { BigPicture } from "./big-picture";
import { DataTab } from "./data";
import { Refresh } from "./refresh";
import { ServicesTab } from "./services";
import { SpeedTab } from "./speed";
import { JobsTab } from "./jobs";
import { SecurityTab } from "./security";
import { CompaniesTab } from "./companies";
import { TAB_HREF } from "./parts";

export const metadata = { title: "Dev tools" };

type Search = { tab?: string; service?: string; days?: string; range?: string; errors?: string; all?: string };

const TABS: { key: DevTab; label: string }[] = [
  { key: "picture", label: "Big picture" },
  { key: "services", label: "Services" },
  { key: "data", label: "Disk, database and backups" },
  { key: "speed", label: "Speed and errors" },
  { key: "jobs", label: "Jobs and emails" },
  { key: "security", label: "Security" },
  { key: "companies", label: "Companies" },
];

/**
 * Dev tools (platform admin): how the server and the app are doing. Big picture (what needs you,
 * everything watched, what happened), Services (each container and its live log), Disk,
 * database and backups, Speed and errors, Jobs and emails, Security, and Companies. The server writes its status every minute (deploy/server).
 */
export default async function DevToolsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const tab: DevTab = TABS.find((t) => t.key === sp.tab)?.key ?? "picture";
  const overview = await platformApi.get<DevOverview>("/dev-tools/overview");
  const errors = sp.errors === "fixed" ? "fixed" : "open";
  const [services, data, speed, jobs, security, companies] = await Promise.all([
    tab === "services" ? platformApi.get<DevServicesView>("/dev-tools/services") : null,
    tab === "data" ? platformApi.get<DevDataView>("/dev-tools/data") : null,
    tab === "speed" ? platformApi.get<DevSpeedView>("/dev-tools/speed", { range: sp.range === "7d" ? "7d" : undefined, errors }) : null,
    tab === "jobs" ? platformApi.get<DevJobsView>("/dev-tools/jobs") : null,
    tab === "security" ? platformApi.get<DevSecurityView>("/dev-tools/security") : null,
    tab === "companies" ? platformApi.get<DevCompaniesView>("/dev-tools/companies") : null,
  ]);
  const zone = currentZone();
  const checked = overview.checkedAt
    ? `Last check ${new Date(overview.checkedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: zone })}`
    : "Not checked yet";
  const problems = (t: DevTab) => overview.checks.filter((c) => c.tab === t && (c.level === "warn" || c.level === "bad"));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Dev tools" actions={<Refresh checked={checked} />} />
      <LinkTabs
        label="Dev tools sections"
        tabs={TABS.map((t) => {
          const p = problems(t.key);
          return {
            href: TAB_HREF[t.key],
            label: t.label,
            active: t.key === tab,
            count: p.length || undefined,
            alert: p.some((c) => c.level === "bad"),
          };
        })}
      />
      {tab === "picture" && <BigPicture o={overview} days={sp.days === "7" ? 7 : 1} />}
      {tab === "services" && services && <ServicesTab v={services} picked={sp.service} />}
      {tab === "data" && data && <DataTab d={data} />}
      {tab === "speed" && speed && <SpeedTab v={speed} errors={errors} />}
      {tab === "jobs" && jobs && <JobsTab v={jobs} />}
      {tab === "security" && security && <SecurityTab v={security} />}
      {tab === "companies" && companies && <CompaniesTab v={companies} all={sp.all === "1"} />}
    </div>
  );
}
