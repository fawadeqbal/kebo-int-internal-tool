import { siteHost, type LeadOrigin } from "@kebo/shared";

/** The query a marketing link carries so the form knows where the visitor came from (no cookies). */
type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim().slice(0, 200) || undefined;

/** The site that sent them ("google.com"), from the Referer header: not our own addresses. */
export function referrerOf(referer: string | null | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    const host = siteHost(new URL(referer).host);
    const base = process.env.BASE_DOMAIN?.toLowerCase();
    if (base && (host === base || host.endsWith(`.${base}`))) return undefined;
    return host || undefined;
  } catch {
    return undefined;
  }
}

/** Where they came from: campaign tags (utm_*), the referring site (ref, or the Referer header), the page and button. */
export function originOf(sp: Params, referer?: string | null, page?: string): LeadOrigin {
  return {
    source: one(sp.utm_source) ?? null,
    medium: one(sp.utm_medium) ?? null,
    campaign: one(sp.utm_campaign) ?? null,
    referrer: one(sp.ref) ?? referrerOf(referer) ?? null,
    page: one(sp.page) ?? page ?? null,
    cta: one(sp.cta) ?? null,
  };
}

/** The same, as a query string for a link to a form ("?utm_source=…&cta=hero"). */
export function originQuery(o: LeadOrigin, cta?: string): string {
  const q = new URLSearchParams();
  if (o.source) q.set("utm_source", o.source);
  if (o.medium) q.set("utm_medium", o.medium);
  if (o.campaign) q.set("utm_campaign", o.campaign);
  if (o.referrer) q.set("ref", o.referrer);
  if (o.page) q.set("page", o.page);
  if (cta) q.set("cta", cta);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Hidden form fields carrying the origin. */
export const ORIGIN_FIELDS = ["source", "medium", "campaign", "referrer", "page", "cta"] as const;

/** The origin back from a form's hidden fields. */
export function originFromForm(form: FormData): LeadOrigin | null {
  const o: LeadOrigin = {};
  let any = false;
  for (const k of ORIGIN_FIELDS) {
    const v = String(form.get(`origin.${k}`) ?? "").trim();
    if (v) {
      o[k] = v.slice(0, 200);
      any = true;
    }
  }
  return any ? o : null;
}
