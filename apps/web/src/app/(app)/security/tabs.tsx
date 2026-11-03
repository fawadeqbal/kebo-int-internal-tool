"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { SectionList } from "@kebo/ui";

/** Security's sections down the left (chips on a phone): roles (and how people stand), signed-in devices, sign-in history. */
export function SecuritySections({ failed, children }: { failed: number; children: ReactNode }) {
  const path = usePathname();
  const items = [
    { href: "/security", label: "Roles", active: path === "/security" || path.startsWith("/security/roles") },
    { href: "/security/sessions", label: "Signed in now", active: path.startsWith("/security/sessions") },
    {
      href: "/security/sign-ins",
      label: "Sign-in history",
      active: path.startsWith("/security/sign-ins"),
      ...(failed ? { count: <span title={`${failed} failed in the last 24 hours`}>{failed}</span>, alert: true } : {}),
    },
  ];
  return (
    <SectionList label="Security sections" items={items} wide>
      {children}
    </SectionList>
  );
}
