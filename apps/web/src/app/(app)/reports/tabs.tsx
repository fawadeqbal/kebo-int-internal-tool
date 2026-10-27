import { LinkTabs } from "@kebo/ui";

/** The two reports: deals and sales (everyone with reports), and where we lose money (managers). */
export function ReportTabs({ active }: { active: "deals" | "money" }) {
  return (
    <LinkTabs
      label="Reports"
      className="mb-5"
      tabs={[
        { href: "/reports", label: "Deals and sales", active: active === "deals" },
        { href: "/reports/money", label: "Where we lose money", active: active === "money" },
      ]}
    />
  );
}
