import { Laptop, LogOut, Smartphone } from "lucide-react";
import { Badge, cn, PhoneList, PhoneRow, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { dateTime, timeAgo } from "@/lib/format";
import type { ActionState } from "@/lib/actions";
import type { SessionRow } from "@/lib/types-people";
import { ConfirmAction } from "@/components/people/confirm-action";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

const isPhone = (device: string) => /Android|iPhone|Kebo app/.test(device);

/**
 * Signed-in browsers and phones: what, where from, since when and last used, each with Sign out — the one list
 * table on a laptop and phone rows on a phone (canvas board "One list page for all 25 lists"). `showPerson` for
 * Security (everyone's), not My account.
 */
export function SessionList({ sessions, end, showPerson = false }: { sessions: SessionRow[]; end: (id: string) => Action; showPerson?: boolean }) {
  const device = (s: SessionRow) => {
    const Icon = isPhone(s.device) ? Smartphone : Laptop;
    return (
      <span className="inline-flex flex-wrap items-center gap-2 font-medium">
        <Icon className={cn("size-4 shrink-0", s.current ? "text-primary" : "text-muted")} aria-hidden />
        <span title={s.userAgent ?? undefined}>{s.device}</span>
        {s.current && <Badge tone="ok">This device</Badge>}
        {s.waitingForCode && <Badge tone="warn">Waiting for the two-step code</Badge>}
      </span>
    );
  };
  const signOut = (s: SessionRow) =>
    !s.current && (
      <ConfirmAction
        action={end(s.id)}
        confirm={showPerson ? `Sign ${s.user.name} out of ${s.device}?` : `Sign out ${s.device}? It will need the password again.`}
        label="Sign out"
        what={showPerson ? `${s.user.name}, ${s.device}` : s.device}
        icon={<LogOut aria-hidden />}
        pendingText="Signing out…"
        variant="secondary"
        size="xs"
        showSuccess={false}
      />
    );
  const lastUsed = (s: SessionRow) => <time title={dateTime(s.lastSeenAt)}>{timeAgo(s.lastSeenAt)}</time>;
  return (
    <>
      <div className="max-sm:hidden">
        <Table aria-label="Sessions">
          <THead>
            <tr>
              {showPerson && <Th>Who</Th>}
              <Th>Device</Th>
              <Th>From</Th>
              <Th>Signed in</Th>
              <Th>Last used</Th>
              <Th>
                <span className="sr-only">Sign out</span>
              </Th>
            </tr>
          </THead>
          <tbody>
            {sessions.map((s) => (
              <Tr key={s.id}>
                {showPerson && <Td className="font-medium">{s.user.name}</Td>}
                <Td>{device(s)}</Td>
                <Td className="text-text-2 tabular">{s.ip ?? "—"}</Td>
                <Td className="whitespace-nowrap text-text-2">{dateTime(s.signedInAt)}</Td>
                <Td className="whitespace-nowrap text-text-2">{lastUsed(s)}</Td>
                <Td className="text-right">{signOut(s)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
      <PhoneList label="Sessions">
        {sessions.map((s) => (
          <PhoneRow
            key={s.id}
            title={showPerson ? `${s.user.name} · ${s.device}` : s.device}
            line={
              <>
                {s.ip ? `${s.ip} · ` : ""}last used {lastUsed(s)}
              </>
            }
            status={s.current ? <Badge tone="ok">This device</Badge> : s.waitingForCode ? <Badge tone="warn">Waiting for the code</Badge> : undefined}
            extra={signOut(s) || undefined}
          />
        ))}
      </PhoneList>
    </>
  );
}
