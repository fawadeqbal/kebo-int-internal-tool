import type { DomainDiagnosis, OwnDomainView } from "@kebo/shared";

/** GET /platform/companies/:id/domain: its address under ours, its own domain, and the domain's look-up. */
export type PlatformDomainView = OwnDomainView & { enabled: boolean; diagnosis: DomainDiagnosis | null };
