import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { LIFECYCLE, marketingOrigin } from "@kebo/shared";
import {
  Alert,
  buttonClass,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  SectionList,
  StatusBadge,
  Table,
  Td,
  Th,
  THead,
  Tr,
} from "@kebo/ui";
import { platformApi } from "@/lib/api";
import { requirePlatformAdmin } from "@/lib/platform";
import { dateTime, timeAgo } from "@/lib/format";
import type { PlatformSettings } from "@/lib/types-platform";
import { GroupCard } from "@/components/platform/group-card";
import { SiteNumbersCard } from "@/components/platform/site-numbers";
import { SiteEditor } from "../website/editor";
import { PublishButtons } from "../website/publish";
import type { SiteEditorView, SiteNumbers } from "../website/types";
import { PasswordEdit } from "../account/form";

export const metadata = { title: "Settings" };

const SECTIONS = [
  { key: "website", label: "Website" },
  { key: "sign-up", label: "Sign-up and demos" },
  { key: "emails", label: "Emails" },
  { key: "backups", label: "Backups" },
  { key: "account", label: "My account" },
  { key: "admins", label: "Platform admins" },
] as const;
type Section = (typeof SECTIONS)[number]["key"];

const onOff = (on: boolean) => <StatusBadge meaning={on ? "ok" : "neutral"}>{on ? "On" : "Off"}</StatusBadge>;
const SERVER = "Set on the server (.env, then restart): ";

/**
 * Platform settings (design system: Settings frame, approved page 30): the
 * sections down the left (chips on a phone) — Website, Sign-up and demos,
 * Emails, Backups, My account, Platform admins — each a few group cards. What
 * comes from the server's settings is shown read-only with where it is set;
 * the website's words and your password change here. The old Website and
 * account pages send people here.
 */
export default async function PlatformSettingsPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const sp = await searchParams;
  const section: Section = SECTIONS.find((s) => s.key === sp.section)?.key ?? "website";
  const [me, s] = await Promise.all([requirePlatformAdmin(), platformApi.get<PlatformSettings>("/settings")]);
  const [site, numbers] =
    section === "website"
      ? await Promise.all([platformApi.get<SiteEditorView>("/site"), platformApi.get<SiteNumbers>("/site/numbers").catch(() => null)])
      : [null, null];
  const live = s.baseDomain ? marketingOrigin(s.baseDomain, "") : "/site";
  const counts: Partial<Record<Section, number>> = {
    admins: s.admins.filter((a) => a.active).length,
    backups: s.serverWarnings.length || undefined,
  };

  return (
    <div>
      <PageHeader
        title="Platform settings"
        summary="How the platform works for everyone: the website, sign-up and demos, emails, backups, and who runs it."
      />
      <SectionList
        label="Settings sections"
        boxed
        items={SECTIONS.map((x) => ({
          href: x.key === "website" ? "/platform/settings" : `/platform/settings?section=${x.key}`,
          label: x.label,
          active: x.key === section,
          count: counts[x.key],
          alert: x.key === "backups" && s.serverWarnings.length > 0,
        }))}
        wide={section === "website"}
      >
        {section === "website" && site && (
          <>
            <Card>
              <CardHeader
                title="Marketing site"
                description={`What visitors see at ${live.replace(/^https?:\/\//, "") || "/site"}: save a draft, look at it, then publish.`}
                actions={
                  <>
                    <a href={live} target="_blank" rel="noreferrer" className={buttonClass("ghost", "sm")}>
                      <ExternalLink aria-hidden /> Live page<span className="sr-only"> (opens in a new tab)</span>
                    </a>
                    <Link href="/platform/preview" target="_blank" className={buttonClass("secondary", "sm")}>
                      Look at the draft<span className="sr-only"> (opens in a new tab)</span>
                    </Link>
                    <PublishButtons unpublished={site.unpublished} live={!!site.published} />
                  </>
                }
              />
              <CardBody className="text-sm text-text-2">
                {site.unpublished
                  ? `The saved draft is not live yet${site.updatedBy ? ` (last saved by ${site.updatedBy}${site.updatedAt ? `, ${dateTime(site.updatedAt)}` : ""})` : ""}. Look at it, then publish.`
                  : site.publishedAt
                    ? `Live since ${dateTime(site.publishedAt)}${site.updatedBy ? `, published by ${site.updatedBy}` : ""}.`
                    : "Not published yet."}
              </CardBody>
            </Card>
            <SiteEditor key={site.updatedAt ?? "new"} initial={site.draft} plans={site.plans} />
            {numbers && <SiteNumbersCard n={numbers} title="Visitors and leads" edit={null} />}
          </>
        )}

        {section === "sign-up" && (
          <>
            <GroupCard
              id="sign-up"
              title="Self sign-up"
              description="a 14-day trial company with the person as its tenant admin, after they confirm their email"
              note={`${SERVER}SIGN_UP_OPEN=true (it also needs email). Closed, the page offers "Request a demo".`}
              items={[
                { label: "Sign-up", value: onOff(s.signUpOpen) },
                { label: "Trial", value: `${LIFECYCLE.trialDays} days` },
                { label: "Bot check", value: s.botCheck ? "Cloudflare Turnstile" : "Off" },
              ]}
            />
            <GroupCard
              id="demo-form"
              title="Request a demo form"
              description="where client inquiries come from; each one is emailed to the platform admins"
              note={`${SERVER}TURNSTILE_SECRET_KEY (bot check), PUBLIC_INQUIRIES_PER_HOUR.`}
              items={[
                { label: "Form", value: onOff(true) },
                { label: "Bot check", value: s.botCheck ? "Turnstile · on" : "Off" },
                { label: "Per hour", value: `${s.inquiriesPerHour} from one address` },
              ]}
            />
            <GroupCard
              id="demos"
              title="Demos and trials"
              description="what happens when they end (the automatic rules, every hour)"
              items={[
                { label: "A demo lasts", value: `${LIFECYCLE.demoDays} days (or as chosen)` },
                { label: "After the end", value: `read-only ${LIFECYCLE.readOnlyDays} days, then off` },
                {
                  label: "Deleted",
                  value: `${LIFECYCLE.readOnlyDays + LIFECYCLE.deleteAfterOffDays} days after the end, unless it paid or was set by hand`,
                },
                {
                  label: "Clients overdue",
                  value: `read-only after ${LIFECYCLE.overdueGraceDays} days, off after ${LIFECYCLE.overdueOffDays}; never deleted`,
                },
              ]}
              columns={2}
            />
          </>
        )}

        {section === "emails" && (
          <>
            <GroupCard
              id="email"
              title="Sending email"
              description="set-password links, demo and renewal emails, warnings"
              note={`${SERVER}SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM. Without it, links are shown to you to send yourself.`}
              items={[{ label: "Email", value: onOff(s.emailOn) }]}
            />
            <GroupCard
              id="platform-email"
              title="Where platform emails go"
              description="new client inquiries, sign-ups, demos ending, server warnings"
              note={`${SERVER}PLATFORM_EMAIL (comma-separated). Empty: every platform admin.`}
              items={[
                {
                  label: "Sent to",
                  value:
                    s.platformEmail?.join(", ") ??
                    `every platform admin (${s.admins
                      .filter((a) => a.active)
                      .map((a) => a.email)
                      .join(", ")})`,
                  wide: true,
                },
              ]}
              columns={2}
            />
          </>
        )}

        {section === "backups" && (
          <>
            <GroupCard
              id="backup-rules"
              title="Backups"
              description="the database every night, kept on the server and copied off it; every deploy copies the database first"
              note="The worker reads the backup and disk status every hour and emails the platform admins once a day while something is wrong. See docs/restore.md."
              items={[
                { label: "Database", value: "every night" },
                { label: "Before each deploy", value: "a copy (the last 10 kept)" },
                {
                  label: "Warns when",
                  value: "the last good backup is over 26 hours old, a backup or its off-site copy failed, or the disk is 80% full",
                },
              ]}
            />
            <Card>
              <CardHeader title="Warnings, last 7 days" description="from the server's checks" />
              {s.serverWarnings.length ? (
                <ul className="divide-y divide-line">
                  {s.serverWarnings.map((w) => (
                    <li key={w.id} className="px-4 py-2.5">
                      <p className="text-sm font-medium">{w.title}</p>
                      {w.detail && <p className="text-xs text-text-2">{w.detail}</p>}
                      <p className="text-xs text-muted">{dateTime(w.at)}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  framed
                  title="No warnings"
                  description="Backups are recent and the disk has room. A problem shows here and is emailed to you."
                />
              )}
            </Card>
          </>
        )}

        {section === "account" && (
          <>
            <GroupCard
              id="me"
              title="You"
              description="your sign-in to the platform"
              items={[
                { label: "Name", value: me.name },
                { label: "Email", value: me.email },
                { label: "Two-step sign-in", value: <StatusBadge meaning="ok">On (always, for platform admins)</StatusBadge> },
              ]}
            />
            <Card>
              <CardHeader
                title="Password"
                description="Changing it signs you out on your other devices."
                className="max-sm:flex-row max-sm:gap-3"
                actions={<PasswordEdit />}
              />
              <CardBody>
                <dl>
                  <dt className="text-xs text-muted">Password</dt>
                  <dd className="mt-0.5 text-sm tracking-widest" aria-label="Set, hidden">
                    ••••••••••
                  </dd>
                </dl>
              </CardBody>
            </Card>
          </>
        )}

        {section === "admins" && (
          <Card className="overflow-clip">
            <CardHeader
              title={`Platform admins · ${s.admins.length}`}
              description="who runs the platform; each signs in with a password and an authenticator code"
            />
            <Table aria-label="Platform admins" data-fit="">
              <THead>
                <tr>
                  <Th>Person</Th>
                  <Th>Sign-in</Th>
                  <Th className="text-right max-sm:hidden">Last signed in</Th>
                </tr>
              </THead>
              <tbody>
                {s.admins.map((a) => (
                  <Tr key={a.id} className={a.active ? "" : "text-text-2"}>
                    <Td className="py-2">
                      <span className="block font-medium">
                        {a.name}
                        {a.email === me.email && <span className="font-normal text-muted"> (you)</span>}
                      </span>
                      <span className="block text-xs text-muted">{a.email}</span>
                    </Td>
                    <Td>
                      {!a.active ? (
                        <StatusBadge meaning="neutral">Switched off</StatusBadge>
                      ) : a.twoStepOn ? (
                        <StatusBadge meaning="ok">Two-step on</StatusBadge>
                      ) : (
                        <StatusBadge meaning="warn">Not set up yet</StatusBadge>
                      )}
                    </Td>
                    <Td className="text-right text-xs whitespace-nowrap text-text-2 max-sm:hidden">
                      {a.lastLoginAt ? timeAgo(a.lastLoginAt) : "Never"}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Alert tone="info" className="m-4">
              Platform admins are added and switched off on the server:{" "}
              <code className="font-mono text-xs">platform-admin add you@example.com &quot;Your Name&quot;</code> (prints a link to set the
              password) and <code className="font-mono text-xs">platform-admin off …</code>. See docs/companies.md.
            </Alert>
          </Card>
        )}
      </SectionList>
    </div>
  );
}
