import { Bell, FileText, Globe, KeyRound, LayoutGrid, Link2, List, Lock, Mail, Shield, Users, History, type LucideIcon } from "lucide-react";
import { LinkTabs } from "@kebo/ui";

type Tab = { href: string; label: string; icon: LucideIcon };

/** System & admin › people (board UsersList…): Users, Roles, Sessions, Sign-ins, Audit log. */
const PEOPLE: Tab[] = [
  { href: "/users", label: "Users", icon: Users },
  { href: "/access/roles", label: "Roles", icon: Shield },
  { href: "/access/sessions", label: "Sessions", icon: KeyRound },
  { href: "/access/sign-ins", label: "Sign-ins", icon: Lock },
  { href: "/audit", label: "Audit log", icon: History },
];

/** System & admin › settings (board SettingsCompany…): one tab per settings page. */
const SETTINGS: Tab[] = [
  { href: "/settings/company", label: "Company", icon: LayoutGrid },
  { href: "/settings/sales", label: "Sales & quotations", icon: FileText },
  { href: "/settings/reminders", label: "Reminders", icon: Bell },
  { href: "/settings/emails", label: "Emails", icon: Mail },
  { href: "/settings/order-checklist", label: "Order steps", icon: List },
  { href: "/settings/papers", label: "Papers we use", icon: FileText },
  { href: "/settings/address", label: "Company address", icon: Globe },
  { href: "/settings/website-form", label: "Website form", icon: Link2 },
];

/** The tab bar of an admin page: the people pages or the settings pages, the current one marked. */
export function AdminTabs({ set, current, only }: { set: "people" | "settings"; current: string; only?: string[] }) {
  const tabs = (set === "people" ? PEOPLE : SETTINGS).filter((t) => !only || only.includes(t.href));
  return (
    <LinkTabs
      label={set === "people" ? "People and access" : "Settings"}
      className="no-print mt-3"
      tabs={tabs.map((t) => ({
        href: t.href,
        label: (
          <>
            <t.icon aria-hidden /> {t.label}
          </>
        ),
        active: current === t.href || current.startsWith(`${t.href}/`),
      }))}
    />
  );
}
