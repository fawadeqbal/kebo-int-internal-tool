"use client";

import { usePathname } from "next/navigation";
import { LinkTabs } from "@kebo/ui";

/** Security's sections: roles (and how people stand), signed-in devices, sign-in history. */
export function SecurityTabs({ failed }: { failed: number }) {
  const path = usePathname();
  const tabs = [
    { href: "/security", label: "Roles", active: path === "/security" || path.startsWith("/security/roles") },
    { href: "/security/sessions", label: "Signed in now", active: path.startsWith("/security/sessions") },
    { href: "/security/sign-ins", label: "Sign-in history", active: path.startsWith("/security/sign-ins"), ...(failed ? { count: failed, alert: true } : {}) },
  ];
  return <LinkTabs label="Security sections" tabs={tabs} className="mb-5" />;
}
