import { cache } from "react";
import type { ColourSet } from "@kebo/shared";
import { addressCompany, apiFetch } from "@/lib/api";
import { savedColours } from "@/lib/colours";
import { bodyOf, ignore } from "@/lib/quiet";

export interface CompanyLook {
  name: string;
  colours: ColourSet;
  /** Where its logo is served for the pages before sign-in (with its version), or null: it has none. */
  logoSrc: string | null;
}

/**
 * White label: at a company's own address, the pages before sign-in wear its name, colours and logo, and never
 * the product's. Null anywhere else (the platform, the marketing site, one address for everything) or when the
 * company is off. Asked once per request.
 */
export const companyLook = cache(async (): Promise<CompanyLook | null> => {
  const slug = await addressCompany();
  if (!slug) return null;
  const res = await apiFetch(`/platform/public/company-look?slug=${encodeURIComponent(slug)}`, { auth: false }).catch(
    ignore("the company's look for the pages before sign-in (they show the plain look)"),
  );
  if (!res?.ok) return null;
  const body = await bodyOf<{ name?: string; colours?: string; logo?: string | null }>(res);
  if (!body?.name) return null;
  return {
    name: body.name,
    colours: savedColours(body.colours),
    logoSrc: body.logo ? `/sign-in-logo?v=${encodeURIComponent(body.logo)}` : null,
  };
});
