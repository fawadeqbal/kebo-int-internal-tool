import { Send } from "lucide-react";
import { can } from "@kebo/shared";
import { api } from "@/lib/api";
import { hasFeature, type Me } from "@/lib/session";
import { qty } from "@/lib/format";
import type { DealDetail } from "@/lib/types";
import type { FactoryRequests } from "@/lib/types-flow";
import { optional } from "@/components/print/data";
import { today } from "@/components/orders/today";
import { PanelButton } from "@/components/orders/step-view";
import { FactoriesAsked } from "@/components/deals/factories-asked";
import { askFactoriesAction, factoryRequestStatusAction, removeFactoryRequestAction } from "../factory-request-actions";

/**
 * "Ask factories": who has the customer's list and who has answered, and the
 * form to send it to more (today's Factories asked card), in a side panel.
 * Null for people who do not see factory prices, or without the module.
 */
export async function askFactories(d: DealDetail, me: Me, variant: "ghost" | "secondary" = "secondary") {
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
  const { asked, quoted, waiting } = requests.counts;
  return {
    counts: requests.counts,
    button: (
      <PanelButton
        variant={variant}
        size="md"
        icon={variant === "secondary" ? <Send aria-hidden /> : undefined}
        label="Ask factories"
        title="Factories asked"
        description={asked ? `${asked} asked · ${quoted} answered${waiting ? ` · ${waiting} waiting` : ""}` : "Send the customer's list to two or three factories."}
        body={
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <FactoriesAsked
              data={requests}
              ask={askFactoriesAction.bind(null, d.id)}
              statusActions={Object.fromEntries(requests.items.map((r) => [r.id, factoryRequestStatusAction.bind(null, d.id, r.id)]))}
              removeActions={Object.fromEntries(requests.items.map((r) => [r.id, removeFactoryRequestAction.bind(null, d.id, r.id)]))}
              message={message}
              excelHref={excel ? `/sheets/export/factory-list?id=${d.id}` : null}
              files={d.attachments.map((f) => ({ id: f.id, name: f.fileName, size: f.size }))}
              sourcingHref={`/inquiries/${d.id}/sourcing?add=1`}
              canEdit={d.canWork}
              today={today()}
              closed={d.stage === "won" || d.stage === "lost"}
              startAsking
            />
          </div>
        }
      />
    ),
  };
}
