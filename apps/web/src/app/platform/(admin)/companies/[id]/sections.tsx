import Link from "next/link";
import type { ReactNode } from "react";
import { FileSpreadsheet, Plus } from "lucide-react";
import { COMPANY_KIND_LABEL, COMPANY_LOG_KINDS, LIFECYCLE, planFeatureName, type CompanyLogKind } from "@kebo/shared";
import { Badge, buildHref, buttonClass, Card, cn, EmptyState, ListToolbar, Pager, StatusBadge, Table, Td, Th, THead, Tr, StatTile } from "@kebo/ui";
import type { ISODate } from "@kebo/utils";
import { RowMenu } from "@/components/common/more-menu";
import { date, dateTime, money, timeAgo } from "@/lib/format";
import type { ActionState } from "@/lib/actions";
import type { CompanyDetail, CompanyHistory, LogEntry } from "@/lib/types-platform";
import { GroupCard, ModulesList, PanelButton } from "./cards";
import { attention, daysTo, inDays, modulesOn, paidShare, paidState, sectionHref, storage, type Meaning } from "./model";
import type { SavedCard } from "./panels";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

const DOT: Record<Meaning, string> = { neutral: "bg-text-2", info: "bg-info", ok: "bg-ok", warn: "bg-warn", bad: "bg-bad" };

/* ---------------------------------------------------------------- pieces */

/** A card with a title, one line under it and its own header action (design system: card). */
function Box({
  title,
  description,
  action,
  children,
  className,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <Card id={id} className={cn("overflow-clip", className)} aria-labelledby={id ? `${id}-title` : undefined}>
      <div
        className={cn(
          "flex min-h-14 items-start justify-between gap-3 border-b border-line px-4 py-3",
          description && action && "max-sm:flex-col max-sm:gap-2",
        )}
      >
        <div className="min-w-0">
          <h2 id={id ? `${id}-title` : undefined} className="text-sm font-semibold text-text">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {children}
    </Card>
  );
}

/** A thin bar (its numbers are written beside it, so it is only a picture). */
function Bar({ percent, tone = "primary", className }: { percent: number; tone?: "primary" | "warn" | "bad"; className?: string }) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <span aria-hidden className={cn("block h-1.5 overflow-hidden rounded-full bg-surface-3", className)}>
      <span
        className={cn("block h-full rounded-full", tone === "warn" ? "bg-warn" : tone === "bad" ? "bg-bad" : "bg-primary-solid")}
        style={{ width: `${p}%` }}
      />
    </span>
  );
}

function Pairs({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-line px-4">
      {items.map((i) => (
        <div key={i.label} className="flex items-baseline justify-between gap-4 py-2.5">
          <dt className="text-xs text-text-2">{i.label}</dt>
          <dd className="text-right text-sm font-medium tabular">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One entry of the company's history: what happened, then who and when. */
export function LogList({ entries, empty = "Nothing yet." }: { entries: LogEntry[]; empty?: string }) {
  if (!entries.length) return <p className="px-4 py-4 text-sm text-muted">{empty}</p>;
  return (
    <ol className="divide-y divide-line px-4">
      {entries.map((e) => (
        <li key={e.id} className="py-2.5">
          <p className="text-sm break-words">{e.summary}</p>
          <p className="mt-0.5 text-xs text-muted">
            <span className="font-medium text-text-2">{e.adminName ?? "Automatic rules"}</span> ·{" "}
            <time dateTime={e.at}>{dateTime(e.at)}</time>
          </p>
        </li>
      ))}
    </ol>
  );
}

const lastActive = (at: string | null) => (at ? timeAgo(at) : "Never");
/** The later of two moments (either may be missing). */
const latest = (a: string | null, b: string | null) => (!a ? b : !b ? a : new Date(a) > new Date(b) ? a : b);

/* ---------------------------------------------------------------- Overview */

export function OverviewSection({ c, today }: { c: CompanyDetail; today: ISODate }) {
  const a = c.activity;
  const items = attention(c, today);
  const users = c.usage?.users ?? 0;
  const mb = c.usage?.storageMb ?? 0;
  const paid = paidState(c, today);
  const share = paidShare(c, today);
  const ends = c.kind !== "client" && c.endsAt ? new Date(c.endsAt) : null;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile
          size="sm"
          label="People"
          value={c.plan?.maxUsers ? `${users} of ${c.plan.maxUsers}` : users}
          bar={
            c.plan?.maxUsers ? (
              <Bar className="my-1" percent={(users / c.plan.maxUsers) * 100} tone={users >= c.plan.maxUsers ? "bad" : "primary"} />
            ) : undefined
          }
          sub={a ? `${a.signedInThisWeek} signed in this week` : undefined}
        />
        <StatTile
          size="sm"
          label="Files"
          value={c.plan?.maxStorageMb ? `${storage(mb)} of ${storage(c.plan.maxStorageMb)}` : storage(mb)}
          bar={
            c.plan?.maxStorageMb ? (
              <Bar className="my-1" percent={(mb / c.plan.maxStorageMb) * 100} tone={mb >= c.plan.maxStorageMb ? "bad" : "primary"} />
            ) : undefined
          }
          sub={c.plan?.maxStorageMb ? `${Math.round((mb / c.plan.maxStorageMb) * 100)}% used` : "no limit"}
        />
        <StatTile
          size="sm"
          label="Last active"
          value={lastActive(latest(c.lastActiveAt, a?.lastSignIn?.at ?? null))}
          sub={a?.lastSignIn ? `last sign-in: ${a.lastSignIn.name ?? a.lastSignIn.email}` : "nobody has signed in yet"}
        />
        {c.kind === "client" ? (
          <StatTile
            size="sm"
            label="Paid until"
            value={c.renewsOn ? date(c.renewsOn) : "No date"}
            bar={share !== null ? <Bar className="my-1" percent={share} tone={paid?.meaning === "bad" ? "bad" : "warn"} /> : undefined}
            sub={paid?.sub}
          />
        ) : (
          <StatTile
            size="sm"
            label={`${COMPANY_KIND_LABEL[c.kind]} ends`}
            value={ends ? date(c.endsAt) : "No end"}
            sub={ends ? (ends <= new Date() ? "ended" : `ends ${inDays(daysTo(today, c.endsAt) ?? 0)}`) : undefined}
          />
        )}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[1.1fr_1fr]">
        <Box title="Needs attention" description={items.length ? "what to deal with, and where" : undefined}>
          {items.length ? (
            <ul className="divide-y divide-line px-4">
              {items.map((i) => (
                <li key={i.key} className="flex items-start gap-3 py-2.5">
                  <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[i.meaning])} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{i.title}</span>
                    {i.sub && <span className="block text-xs text-text-2">{i.sub}</span>}
                  </span>
                  <Link
                    href={i.href}
                    scroll={false}
                    className="inline-flex min-h-6 shrink-0 items-center text-xs font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {i.link} <span aria-hidden>&nbsp;→</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-4 text-sm text-text-2">Nothing needs you: they are paid up, within their limits and signing in safely.</p>
          )}
        </Box>
        <Box title="What they do" description="your own visits don't count">
          {a ? (
            <Pairs
              items={[
                { label: "Inquiries", value: `${a.inquiries} · ${a.inquiriesLast30Days} in 30 days` },
                { label: "Orders", value: `${a.orders} · ${a.openOrders} open` },
                { label: "Sign-ins, 30 days", value: a.signInsLast30Days },
                { label: "Customers · factories", value: `${a.customers} · ${a.factories}` },
                { label: "Modules on", value: modulesOn(c, planFeatureName) },
              ]}
            />
          ) : (
            <p className="px-4 py-4 text-sm text-muted">Deleted: nothing left to count.</p>
          )}
        </Box>
      </div>
      <Box
        title="Recent history"
        description="everything done to this company from the platform"
        action={
          <Link href={sectionHref(c.id, "history")} className={buttonClass("ghost", "sm", "h-8 px-2.5 text-[13px] text-text-2")}>
            All history
          </Link>
        }
      >
        <LogList entries={c.log.slice(0, 5)} />
      </Box>
    </>
  );
}

/* ---------------------------------------------------------------- People */

function SignInBadge({ p }: { p: { active: boolean; locked: boolean } }) {
  if (!p.active) return <StatusBadge meaning="neutral">Switched off</StatusBadge>;
  if (p.locked) return <StatusBadge meaning="bad">Locked</StatusBadge>;
  return <StatusBadge meaning="ok">Can sign in</StatusBadge>;
}

export function PeopleSection({ c }: { c: CompanyDetail }) {
  const people = c.activity?.people ?? [];
  const max = c.plan?.maxUsers;
  const active = people.filter((p) => p.active).length;
  const live = c.status !== "deleted";
  return (
    <Box
      id="people"
      title={`People · ${max ? `${active} of ${max}` : active}`}
      description={
        live
          ? "their accounts; they add people themselves · ⋯ on a tenant admin: send a link to set a new password"
          : "deleted with the company"
      }
    >
      {people.length ? (
        <Table aria-label="People" data-fit="">
          <THead>
            <tr>
              <Th>Person</Th>
              <Th className="max-sm:hidden">Role</Th>
              <Th className="max-sm:hidden">Sign-in</Th>
              <Th className="max-sm:hidden">Two-step</Th>
              <Th className="text-right max-sm:hidden">Last signed in</Th>
              <Th className="w-12">
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </THead>
          <tbody>
            {people.map((p) => (
              <Tr key={p.id} className={cn("group", !p.active && "text-text-2")}>
                <Td className="py-2">
                  <span className="block font-medium">{p.name}</span>
                  <span className="block text-xs text-muted">{p.email}</span>
                  <span className="block text-xs text-text-2 sm:hidden">
                    {p.role}
                    {p.tenantAdmin && " · Tenant admin"} · {p.lastLoginAt ? `signed in ${timeAgo(p.lastLoginAt)}` : "never signed in"}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1.5 sm:hidden">
                    <SignInBadge p={p} />
                    <StatusBadge meaning={p.twoStep ? "ok" : "warn"}>Two-step {p.twoStep ? "on" : "off"}</StatusBadge>
                  </span>
                </Td>
                <Td className="max-sm:hidden">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {p.role}
                    {p.tenantAdmin && <Badge tone="info">Tenant admin</Badge>}
                  </span>
                </Td>
                <Td className="max-sm:hidden">
                  <SignInBadge p={p} />
                </Td>
                <Td className="max-sm:hidden">
                  {p.twoStep ? <StatusBadge meaning="ok">On</StatusBadge> : <StatusBadge meaning="warn">Off</StatusBadge>}
                </Td>
                <Td className="text-right text-xs whitespace-nowrap text-text-2 max-sm:hidden">
                  {p.lastLoginAt ? timeAgo(p.lastLoginAt) : "Never"}
                </Td>
                <Td className="text-right">
                  {live && p.tenantAdmin && (
                    <RowMenu
                      label={`Actions for ${p.name}`}
                      items={[{ label: "Send a link to set a new password", panel: "password-link", id: p.id }]}
                    />
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState
          framed
          title="Nobody here"
          description={live ? "Their people are added inside the company (Settings → People)." : "The company and its people were deleted."}
        />
      )}
    </Box>
  );
}

/* ---------------------------------------------------------------- Plan & modules */

export function PlanSection({ c, modules, saved }: { c: CompanyDetail; modules: Action; saved?: SavedCard }) {
  const live = c.status !== "deleted";
  const p = c.plan;
  const since = Object.fromEntries(
    c.modulesOff.filter((m) => m.at).map((m) => [m.feature, `Switched off for this company on ${date(m.at)}${m.by ? ` by ${m.by}` : ""}`]),
  );
  const ends = c.endsAt ? new Date(c.endsAt) : null;
  return (
    <>
      <Card id="plan" aria-labelledby="plan-title" className={cn("overflow-clip", saved === "plan" && "animate-flash")}>
        <div className="flex min-h-14 items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 id="plan-title" className="text-sm font-semibold">
              Plan
            </h2>
            <p className="mt-0.5 text-xs text-muted">what they pay for, and their limits</p>
          </div>
          {live && <PanelButton panel="change-plan">Change plan</PanelButton>}
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-3.5 xl:grid-cols-4">
          {[
            { label: "Plan", value: p?.name ?? "No plan" },
            { label: "Price", value: p ? (p.priceMinor ? `${money(p.priceMinor / 100, p.currency)} a ${p.period}` : "Free") : "—" },
            { label: "People", value: p?.maxUsers ? `up to ${p.maxUsers}` : "no limit" },
            { label: "Files", value: p?.maxStorageMb ? `up to ${storage(p.maxStorageMb)}` : "no limit" },
          ].map((i) => (
            <div key={i.label} className="min-w-0">
              <dt className="text-xs text-text-2">{i.label}</dt>
              <dd className="mt-0.5 text-sm font-medium">{i.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {c.kind !== "client" && live && (
        <Box
          id="trial"
          title={c.kind === "demo" ? "Demo" : "Trial"}
          description={ends ? `${ends <= new Date() ? "ended" : "ends"} ${dateTime(c.endsAt)}` : "no end date"}
          action={
            <>
              <PanelButton panel="extend">Extend…</PanelButton>
              <PanelButton panel="make-real">Make it a client</PanelButton>
            </>
          }
        >
          <p className="px-4 py-3 text-xs text-text-2">
            After it ends: read-only for {LIFECYCLE.readOnlyDays} days, then off, then deleted after {LIFECYCLE.deleteAfterOffDays} more
            days. Their contact gets an email a day before the end. &ldquo;End it now&rdquo; is in ⋯ at the top.
          </p>
        </Box>
      )}

      <Card id="modules" aria-labelledby="modules-title" className="overflow-clip">
        <div className="border-b border-line px-4 py-3">
          <h2 id="modules-title" className="text-sm font-semibold">
            Modules
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            what their plan includes; switch one off for this company alone (hidden in their app, refused by the API)
          </p>
        </div>
        <ModulesList planFeatures={c.planFeatures} featuresOff={c.featuresOff} since={since} action={modules} disabled={!live} />
      </Card>
    </>
  );
}

/* ---------------------------------------------------------------- Billing */

export function BillingSection({
  c,
  today,
  removePayment,
  saved,
}: {
  c: CompanyDetail;
  today: ISODate;
  removePayment: Record<string, Action>;
  saved?: SavedCard;
}) {
  const live = c.status !== "deleted";
  const client = c.kind === "client";
  const paid = paidState(c, today);
  const share = paidShare(c, today);
  return (
    <Card id="billing" aria-labelledby="billing-title" className={cn("overflow-clip", saved === "billing" && "animate-flash")}>
      <div className="flex min-h-14 items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 id="billing-title" className="text-sm font-semibold">
            Billing
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            {client ? "each payment sets the paid-until date" : `a ${c.kind} pays nothing; make it a client first`}
          </p>
        </div>
        {client && live && (
          <PanelButton panel="record-payment">
            <Plus aria-hidden /> Record payment
          </PanelButton>
        )}
      </div>
      {client ? (
        <>
          <div className="flex flex-col gap-2 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-text-2">
                Paid until <b className="font-semibold text-text">{c.renewsOn ? date(c.renewsOn) : "—"}</b>
                {paid && <> · {paid.sub}</>}
                {live && (
                  <>
                    {" "}
                    ·{" "}
                    <PanelButton panel="paid-until" variant="link" label="Change the paid-until date">
                      change
                    </PanelButton>
                  </>
                )}
              </span>
              {paid && <StatusBadge meaning={paid.meaning}>{paid.label}</StatusBadge>}
            </div>
            {share !== null && <Bar percent={share} tone={paid?.meaning === "bad" ? "bad" : "primary"} className="h-2" />}
          </div>
          {c.payments.length ? (
            <Table aria-label="Payments" data-fit="">
              <THead>
                <tr>
                  <Th>Paid on</Th>
                  <Th className="text-right">Amount</Th>
                  <Th className="max-sm:hidden">Paid until</Th>
                  <Th className="max-sm:hidden">Note</Th>
                  <Th className="w-12">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </THead>
              <tbody>
                {c.payments.map((p) => (
                  <Tr key={p.id} className="group">
                    <Td className="whitespace-nowrap">
                      {date(p.paidOn)}
                      <span className="block text-xs text-text-2 sm:hidden">until {date(p.paidUntil)}</span>
                    </Td>
                    <Td className="text-right whitespace-nowrap tabular">{money(p.amountMinor / 100, p.currency)}</Td>
                    <Td className="whitespace-nowrap max-sm:hidden">{date(p.paidUntil)}</Td>
                    <Td className="text-sm text-text-2 max-sm:hidden">{p.note}</Td>
                    <Td className="text-right">
                      {live && removePayment[p.id] && (
                        <RowMenu
                          label={`Actions for the payment of ${date(p.paidOn)}`}
                          items={[
                            {
                              label: "Remove…",
                              danger: true,
                              confirm: {
                                title: `Remove the payment of ${money(p.amountMinor / 100, p.currency)}?`,
                                body: "The paid-until date stays as it is; change it under Billing if it should go back.",
                                confirmLabel: "Remove the payment",
                              },
                              action: removePayment[p.id]!,
                            },
                          ]}
                        />
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState
              framed
              title="No payments yet"
              description="Each payment they make goes here and sets the paid-until date. Use + Record payment above."
            />
          )}
        </>
      ) : (
        <EmptyState
          framed
          title={`A ${c.kind} has no payments`}
          description={`Payments are recorded for clients only, so the rules never delete a paying company. Make the ${c.kind} a client (Plan & modules), then record what they pay.`}
        />
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- Details */

export function DetailsSection({ c, saved }: { c: CompanyDetail; saved?: SavedCard }) {
  const live = c.status !== "deleted";
  const edit = (panel: string) => (live ? panel : undefined);
  const profile = c.profile;
  return (
    <>
      <GroupCard
        id="company"
        title="Company"
        description="who they are"
        panel={edit("edit-company")}
        editLabel="Edit company"
        flash={saved === "company"}
        items={[
          { label: "Name", value: c.name },
          { label: "Kind", value: COMPANY_KIND_LABEL[c.kind], readOnly: true },
          { label: "Since", value: c.startsOn ? date(c.startsOn) : null, readOnly: true },
        ]}
      />
      <GroupCard
        id="contact"
        title="Main contact"
        description="who we talk to about the account; gets the renewal and payment emails"
        panel={edit("edit-contact")}
        editLabel="Edit main contact"
        flash={saved === "contact"}
        items={[
          { label: "Name", value: c.contactName },
          { label: "Email", value: c.contactEmail },
          { label: "Phone / WhatsApp", value: c.contactPhone ?? null },
        ]}
      />
      <GroupCard
        id="papers"
        title="Address and papers"
        description="their own details, printed on their papers"
        note={live ? "From their Settings → Company: they change these themselves (or open the company to help)." : undefined}
        items={[
          { label: "Legal name", value: profile?.legalName ?? null, readOnly: true },
          { label: "Address", value: profile?.address ?? null, readOnly: true },
          { label: "Tax no.", value: profile?.taxNo ?? null, readOnly: true },
        ]}
      />
      <GroupCard
        id="address"
        title="Web address"
        description="where their people sign in"
        panel={edit("edit-address")}
        editLabel="Edit web address"
        flash={saved === "address"}
        items={[
          { label: "Short name", value: <span className="font-mono">{c.slug}</span> },
          {
            label: "Address",
            value: live ? <span className="break-all">{c.address.replace(/^https?:\/\//, "")}</span> : null,
            readOnly: true,
          },
          { label: "Old short name", value: c.previousSlug ? `${c.previousSlug} (still works for now)` : "none", readOnly: true },
        ]}
      />
      <GroupCard
        id="limits"
        title="Limits"
        description="from the plan"
        note={
          live ? (
            <>
              Change them with the plan:{" "}
              <Link href={sectionHref(c.id, "plan")} className="font-medium text-primary underline-offset-2 hover:underline">
                Plan & modules →
              </Link>
            </>
          ) : undefined
        }
        items={[
          {
            label: "People",
            value: c.plan ? (c.plan.maxUsers ? `${c.plan.maxUsers} (plan)` : "no limit (plan)") : "no limit (no plan)",
            readOnly: true,
          },
          {
            label: "Files",
            value: c.plan ? (c.plan.maxStorageMb ? `${storage(c.plan.maxStorageMb)} (plan)` : "no limit (plan)") : "no limit (no plan)",
            readOnly: true,
          },
        ]}
      />
      <GroupCard
        id="notes"
        title="Notes"
        description="only platform admins see them"
        panel={edit("edit-notes")}
        editLabel="Edit notes"
        flash={saved === "notes"}
        columns={2}
        items={[{ label: "Notes", value: c.notes ? <span className="font-normal whitespace-pre-line">{c.notes}</span> : null, wide: true }]}
      />
    </>
  );
}

/* ---------------------------------------------------------------- History */

export function HistorySection({ c, history, page }: { c: CompanyDetail; history: CompanyHistory; page: number }) {
  const base = `/platform/companies/${c.id}`;
  const kind = history.kind ?? undefined;
  const kinds = [
    ...(Object.keys(COMPANY_LOG_KINDS) as CompanyLogKind[]).map((k) => ({ key: k, label: COMPANY_LOG_KINDS[k].label })),
    ...((history.counts.other ?? 0) > 0 ? [{ key: "other", label: "Other" }] : []),
  ];
  const rows = history.rows.slice((page - 1) * 25, page * 25);
  return (
    <Box
      id="history"
      title={`History · ${history.counts.all ?? 0}`}
      description="everything done to this company from the platform, newest first"
    >
      <ListToolbar
        className="mb-0 border-b border-line px-4 py-2.5"
        label="Kinds of history"
        chips={[
          { key: "all", label: "All", count: history.counts.all ?? 0, href: buildHref(base, { section: "history" }, {}), active: !kind },
          ...kinds.map((k) => ({
            key: k.key,
            label: k.label,
            count: history.counts[k.key] ?? 0,
            href: buildHref(base, { section: "history", kind: k.key }, {}),
            active: kind === k.key,
          })),
        ]}
        end={
          <a
            href={buildHref(`${base}/history-excel`, {}, { kind })}
            download
            className={buttonClass("secondary", "sm")}
            title="Export to Excel"
          >
            <FileSpreadsheet aria-hidden /> Excel
          </a>
        }
      />
      <LogList entries={rows} empty={kind ? "Nothing of this kind yet." : "Nothing yet."} />
      <Pager base={base} params={{ section: "history", kind }} page={page} total={history.rows.length} />
    </Box>
  );
}
