import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { marketingOrigin } from "@kebo/shared";
import { Alert, buttonClass, PageHeader } from "@kebo/ui";
import { platformApi } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { SiteEditor } from "./editor";
import { PublishButtons } from "./publish";
import type { SiteEditorView } from "./types";

export const metadata = { title: "Website" };

/** The marketing page's words: edit a draft, look at it, publish it. */
export default async function WebsitePage() {
  const v = await platformApi.get<SiteEditorView>("/site");
  const live = process.env.BASE_DOMAIN ? marketingOrigin(process.env.BASE_DOMAIN, "") : "/site";
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Website"
        description="The marketing page: what visitors read, the plans it shows, and how people reach you. Save a draft, look at it, then publish."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <a href={live} target="_blank" rel="noreferrer" className={buttonClass("ghost", "sm")}>
              <ExternalLink aria-hidden /> Live page
            </a>
            <Link href="/platform/preview" target="_blank" className={buttonClass("secondary", "sm")}>
              Look at the draft
            </Link>
            <PublishButtons unpublished={v.unpublished} live={!!v.published} />
          </div>
        }
      />
      {v.unpublished ? (
        <Alert tone="info">
          The saved draft is not live yet
          {v.updatedBy ? ` (last saved by ${v.updatedBy}${v.updatedAt ? `, ${dateTime(v.updatedAt)}` : ""})` : ""}. Look at it, then
          publish.
        </Alert>
      ) : v.publishedAt ? (
        <p className="text-sm text-muted">
          Live since {dateTime(v.publishedAt)}
          {v.updatedBy ? `, published by ${v.updatedBy}` : ""}.{" "}
          <Link href="/platform#website" className="font-medium text-primary hover:underline">
            Visitors and leads
          </Link>
        </p>
      ) : null}
      <SiteEditor key={v.updatedAt ?? "new"} initial={v.draft} plans={v.plans} />
    </div>
  );
}
