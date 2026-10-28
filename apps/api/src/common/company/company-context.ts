import { AsyncLocalStorage } from "node:async_hooks";
import type { CompanyKind, CompanyStatus } from "@kebo/database";

/** The company a request (or a background job) works in. */
export interface CompanyInfo {
  id: string;
  slug: string;
  name: string;
  kind: CompanyKind;
  status: CompanyStatus;
  statusReason: string | null;
  endsAt: Date | null;
  planId: string | null;
}

const storage = new AsyncLocalStorage<{ company: CompanyInfo | null }>();

/**
 * Which company the current work belongs to. Set once per request (from the
 * session's company, see CompanyResolver) or per company by background jobs;
 * every database query of company data goes through that company's connection,
 * so nothing here can reach another company's rows.
 */
export const CompanyContext = {
  run<T>(company: CompanyInfo | null, fn: () => T): T {
    return storage.run({ company }, fn);
  },
  /** Change the company of the current request (sign-in picks it after the request started). */
  set(company: CompanyInfo | null) {
    const store = storage.getStore();
    if (!store) throw new Error("No request context to set the company on");
    store.company = company;
  },
  current(): CompanyInfo | null {
    return storage.getStore()?.company ?? null;
  },
  require(): CompanyInfo {
    const c = storage.getStore()?.company;
    if (!c) throw new Error("No company for this work: company data can only be reached inside a company");
    return c;
  },
};
