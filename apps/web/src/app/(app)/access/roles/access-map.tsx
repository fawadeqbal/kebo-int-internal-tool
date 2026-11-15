import { PERMISSION_GROUPS } from "@kebo/shared";
import { Card, CardHeader } from "@kebo/ui";

export type AccessRoute = {
  method: string;
  path: string;
  rule: { kind: "public" } | { kind: "platform" } | { kind: "permissions"; permissions: string[] } | { kind: "signed-in"; rule: string } | { kind: "none" };
};

const CHECKED = "checked inside: ";
const call = (r: AccessRoute) => `${r.method} ${r.path.replace(/^\/api/, "")}`;

function Calls({ routes, note }: { routes: AccessRoute[]; note?: (r: AccessRoute) => string | null }) {
  return (
    <ul className="mt-2 flex flex-col gap-1 pb-1">
      {routes.map((r) => (
        <li key={`${r.method} ${r.path}`} className="text-xs text-text-2">
          <code className="font-mono text-[11.5px] text-text">{call(r)}</code>
          {note?.(r) && <span className="ml-2 text-muted">{note(r)}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * Settings › Roles: what each permission opens, read from the API's own rules (GET /security/access-map, the
 * same decorators the server obeys; a test fails on a call that states none). Per permission: the calls it is
 * needed for, and the calls that check it inside. Then what is open to anyone signed in, and to anyone at all.
 */
export function AccessMapCard({ routes }: { routes: AccessRoute[] }) {
  const needs = (p: string) => routes.filter((r) => r.rule.kind === "permissions" && r.rule.permissions.includes(p));
  const checks = (p: string) => routes.filter((r) => r.rule.kind === "signed-in" && r.rule.rule.startsWith(CHECKED) && r.rule.rule.slice(CHECKED.length).split(", ").includes(p));
  const open = routes.filter((r) => r.rule.kind === "signed-in" && !r.rule.rule.startsWith(CHECKED));
  const publicCalls = routes.filter((r) => r.rule.kind === "public");
  const counted = {
    permission: routes.filter((r) => r.rule.kind === "permissions").length,
    checked: routes.filter((r) => r.rule.kind === "signed-in" && r.rule.rule.startsWith(CHECKED)).length,
  };
  const byRule = new Map<string, AccessRoute[]>();
  for (const r of open) if (r.rule.kind === "signed-in") byRule.set(r.rule.rule, [...(byRule.get(r.rule.rule) ?? []), r]);
  return (
    <Card>
      <CardHeader
        title="What each permission opens"
        description={`Every one of the app's ${routes.length} calls says what opens it: ${counted.permission} need a permission, ${counted.checked} check permissions inside, ${open.length} are open to anyone signed in, ${publicCalls.length} to anyone.`}
      />
      <div className="divide-y divide-line">
        {PERMISSION_GROUPS.map((g) => (
          <section key={g.title} className="px-4 py-3 sm:px-5">
            <h3 className="text-sm font-semibold text-text">{g.title}</h3>
            <ul className="mt-1 flex flex-col">
              {g.items.map((it) => {
                const need = needs(it.permission);
                const inside = checks(it.permission);
                return (
                  <li key={it.permission}>
                    <details className="group py-1">
                      <summary className="tap cursor-pointer text-[13px] text-text-2 marker:text-muted">
                        <span className="font-medium text-text">{it.label}</span>
                        <span className="ml-2 text-xs text-muted">
                          {need.length} {need.length === 1 ? "call" : "calls"}
                          {inside.length > 0 && ` · checked in ${inside.length} more`}
                        </span>
                      </summary>
                      {need.length > 0 && <Calls routes={need} />}
                      {inside.length > 0 && <Calls routes={inside} note={() => "checked inside"} />}
                      {!need.length && !inside.length && <p className="mt-1 pb-1 text-xs text-muted">No call needs it on its own: it changes what other screens show.</p>}
                    </details>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        <section className="px-4 py-3 sm:px-5">
          <details>
            <summary className="tap cursor-pointer text-sm font-semibold text-text">
              Open to anyone signed in <span className="ml-1 text-xs font-normal text-muted">{open.length} calls</span>
            </summary>
            {[...byRule].map(([rule, rs]) => (
              <div key={rule} className="mt-2">
                <p className="text-xs font-medium text-text-2">{rule.charAt(0).toUpperCase() + rule.slice(1)}</p>
                <Calls routes={rs} />
              </div>
            ))}
          </details>
        </section>
        <section className="px-4 py-3 sm:px-5">
          <details>
            <summary className="tap cursor-pointer text-sm font-semibold text-text">
              Open to anyone <span className="ml-1 text-xs font-normal text-muted">{publicCalls.length} calls: signing in, the website&apos;s form</span>
            </summary>
            <Calls routes={publicCalls} />
          </details>
        </section>
      </div>
    </Card>
  );
}
