import { platformApi } from "@/lib/api";
import type { LeadDetail, Plan } from "@/lib/types-platform";
import type { Prefill } from "./form";

/** What New company or demo needs, from ?lead= (a client inquiry) and ?kind= (client or demo). */
export async function newCompanyData(sp: { lead?: string; kind?: string }) {
  const [plans, lead] = await Promise.all([
    platformApi.get<Plan[]>("/plans"),
    sp.lead ? platformApi.get<LeadDetail>(`/leads/${sp.lead}`).catch(() => null) : null,
  ]);
  const prefill: Prefill = {
    kind: sp.kind === "demo" ? "demo" : sp.kind === "client" ? "client" : lead ? "demo" : "client",
    name: lead?.companyName,
    adminName: lead?.name,
    adminEmail: lead?.email,
    leadId: lead?.id,
  };
  return { plans, lead, prefill };
}
