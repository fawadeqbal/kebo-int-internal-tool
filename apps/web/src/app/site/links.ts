import { marketingOrigin, type LeadOrigin } from "@kebo/shared";
import { originQuery } from "@/lib/origin";
import type { SiteLinks } from "@/components/site/marketing";

/** The marketing site's own paths: at get.<BASE_DOMAIN> they are short; without addresses they live under /site. */
export const sitePath = (path: string) => (process.env.BASE_DOMAIN ? path : `/site${path === "/" ? "" : path}`);

/** The page's links, each carrying where the visitor came from and which button they pressed. */
export function siteLinks(origin: LeadOrigin, signUpOpen: boolean): SiteLinks {
  const base = process.env.BASE_DOMAIN ? marketingOrigin(process.env.BASE_DOMAIN, "") : "";
  return {
    demo: (cta) => `${base}/request-a-demo${originQuery(origin, cta)}`,
    signIn: sitePath("/sign-in"),
    signUp: signUpOpen ? (cta) => `${base}/sign-up${originQuery(origin, cta)}` : undefined,
  };
}
