import type { Metadata } from "next";
import { headers } from "next/headers";
import { DEFAULT_SITE, marketingOrigin, type SiteContent } from "@kebo/shared";
import { apiFetch } from "@/lib/api";
import { originOf } from "@/lib/origin";
import { MarketingPage, type SitePlan } from "@/components/site/marketing";
import { contactAction } from "./actions";
import { siteLinks } from "./links";

type Published = { content: SiteContent; plans: SitePlan[] };

async function published(): Promise<Published> {
  const res = await apiFetch("/platform/public/site", { auth: false }).catch(() => null);
  return res?.ok ? ((await res.json()) as Published) : { content: DEFAULT_SITE, plans: [] };
}

export async function generateMetadata(): Promise<Metadata> {
  const { content } = await published();
  const url = process.env.BASE_DOMAIN ? marketingOrigin(process.env.BASE_DOMAIN, "") : undefined;
  return {
    title: { absolute: content.seo.title },
    description: content.seo.description,
    robots: { index: true, follow: true },
    alternates: url ? { canonical: url } : undefined,
    openGraph: {
      title: content.seo.title,
      description: content.seo.description,
      url,
      siteName: "RFQ Desk",
      type: "website",
      images: content.seo.image ? [{ url: content.seo.image }] : undefined,
    },
  };
}

/** The marketing page (get.<BASE_DOMAIN>): the published words and plans. Each view is counted, without cookies. */
export default async function SitePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [sp, h, site, signUp] = await Promise.all([
    searchParams,
    headers(),
    published(),
    apiFetch("/platform/public/sign-up", { auth: false })
      .then((r) => (r.ok ? (r.json() as Promise<{ open: boolean }>) : { open: false }))
      .catch(() => ({ open: false })),
  ]);
  const origin = originOf(sp, h.get("referer"), "/");
  // Counted by the API (bots left out); never holds the page up.
  await apiFetch("/platform/public/visit", {
    method: "POST",
    auth: false,
    body: JSON.stringify({ path: "/", userAgent: h.get("user-agent"), origin }),
  }).catch(() => null);
  return (
    <MarketingPage
      content={site.content}
      plans={site.plans}
      links={siteLinks(origin, signUp.open)}
      origin={origin}
      contactAction={contactAction}
    />
  );
}
