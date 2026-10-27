import { Laptop, LogOut, Smartphone } from "lucide-react";
import { Badge, cn } from "@kebo/ui";
import { dateTime, timeAgo } from "@/lib/format";
import type { ActionState } from "@/lib/actions";
import type { SessionRow } from "@/lib/types-people";
import { ConfirmAction } from "@/components/people/confirm-action";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

const isPhone = (device: string) => /Android|iPhone|Kebo app/.test(device);

/**
 * Signed-in browsers and phones: what, where from, since when and last used,
 * each with Sign out. `showPerson` for Security (everyone's), not My account.
 */
export function SessionList({ sessions, end, showPerson = false }: { sessions: SessionRow[]; end: (id: string) => Action; showPerson?: boolean }) {
  return (
    <ul className="divide-y divide-line">
      {sessions.map((s) => {
        const Icon = isPhone(s.device) ? Smartphone : Laptop;
        return (
          <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <Icon className={cn("size-5 shrink-0", s.current ? "text-primary" : "text-muted")} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {showPerson && <span>{s.user.name} ·</span>}
                <span title={s.userAgent ?? undefined}>{s.device}</span>
                {s.current && <Badge tone="ok">This device</Badge>}
                {s.waitingForCode && <Badge tone="warn">Waiting for the two-step code</Badge>}
              </p>
              <p className="text-xs text-muted">
                {s.ip ? `${s.ip} · ` : ""}signed in {dateTime(s.signedInAt)} · last used <time title={dateTime(s.lastSeenAt)}>{timeAgo(s.lastSeenAt)}</time>
              </p>
            </div>
            {!s.current && (
              <ConfirmAction
                action={end(s.id)}
                confirm={showPerson ? `Sign ${s.user.name} out of ${s.device}?` : `Sign out ${s.device}? It will need the password again.`}
                label="Sign out"
                icon={<LogOut aria-hidden />}
                pendingText="Signing out…"
                variant="secondary"
                size="xs"
                showSuccess={false}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
