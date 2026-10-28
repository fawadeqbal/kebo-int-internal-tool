import { requirePlatformAdmin } from "@/lib/platform";
import { platformApi } from "@/lib/api";
import { MarketingPage } from "@/components/site/marketing";
import { contactAction } from "@/app/site/actions";
import type { SiteEditorView } from "../(admin)/website/types";

export const metadata = { title: "Draft of the marketing page", robots: { index: false, follow: false } };

/** The saved draft of the marketing page, as visitors would see it once published (the forms do not send). */
export default async function SitePreviewPage() {
  await requirePlatformAdmin();
  const v = await platformApi.get<SiteEditorView>("/site");
  const plans = v.draft.plans.show ? v.plans.filter((p) => !v.draft.plans.hidden.includes(p.id)) : [];
  return (
    <>
      <p className="sticky top-0 z-50 bg-[#1b1530] px-4 py-2 text-center text-sm text-white">
        This is the saved draft{v.unpublished ? ", not live yet" : " (the same as the live page)"}. Publish it under Website.
      </p>
      <MarketingPage
        content={v.draft}
        plans={plans}
        links={{ demo: () => "#", signIn: "#" }}
        origin={null}
        contactAction={contactAction}
        preview
      />
    </>
  );
}
