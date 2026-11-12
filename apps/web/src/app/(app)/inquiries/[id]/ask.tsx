import { Factory, Send } from "lucide-react";
import { can } from "@kebo/shared";
import { api } from "@/lib/api";
import { hasFeature, type Me } from "@/lib/session";
import { qty } from "@/lib/format";
import type { DealDetail } from "@/lib/types";
import type { FactoryRequests } from "@/lib/types-flow";
import { optional } from "@/components/print/data";
import { today } from "@/components/orders/today";
import { PanelButton } from "@/components/orders/step-view";
import { AskWindow } from "@/components/deals/ask-window";
import { askFactoriesAction } from "../factory-request-actions";

/**
 * "Ask factories": who has the customer's list and who has answered, and the
 * form to send it to more (today's Factories asked card), in a side panel.
 * Null for people who do not see factory prices, or without the module.
 */
export async function askFactories(d: DealDetail, me: Me, variant: "ghost" | "secondary" | "primary" = "secondary", opts: { label?: string; size?: "sm" | "md" } = {}) {
  if (!can(me, "sourcing.manage") || !(await hasFeature("factory_requests"))) return null;
  const requests = await optional(() => api.get<FactoryRequests>(`/inquiries/${d.id}/factory-requests`));
  if (!requests) return null;
  const excel = await hasFeature("excel");
  const message = [
    "Hello, please quote the attached list:",
    ...d.items.map((i) => `${i.parentId ? "   " : ""}${i.no}. ${i.description.split("\n")[0]}${i.model ? ` (${i.model})` : ""} — ${qty(i.quantity)} ${i.unit}`),
    "",
    "Please give the price basis (EXW or FOB), the lead time and how long the price is valid.",
    `Our reference: ${d.refNo}`,
  ].join("\n");
  return {
    counts: requests.counts,
    button: (
      <PanelButton
        variant={variant}
        size={opts.size ?? "md"}
        icon={variant === "ghost" ? undefined : variant === "primary" || opts.label ? <Factory aria-hidden /> : <Send aria-hidden />}
        label={opts.label ?? "Ask factories"}
        title="Ask factories for prices"
        description={`${d.refNo} · ${d.title}. Each factory gets its own request you can follow.`}
        panelClassName="md:w-[820px]"
        body={<AskWindow data={requests} ask={askFactoriesAction.bind(null, d.id)} message={message} excelHref={excel ? `/sheets/export/factory-list?id=${d.id}` : null} today={today()} />}
      />
    ),
  };
}
