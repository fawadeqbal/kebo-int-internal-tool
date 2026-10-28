import type { SiteContent } from "@kebo/shared";
import type { SitePlan } from "@/components/site/marketing";

/** GET /platform/site */
export interface SiteEditorView {
  draft: SiteContent;
  published: SiteContent | null;
  publishedAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  unpublished: boolean;
  plans: SitePlan[];
}

/** GET /platform/site/numbers */
export interface SiteFigures {
  month: string;
  from: string;
  to: string;
  visitors: number;
  views: number;
  leads: number;
  demos: number;
  clients: number;
  channels: { channel: string; visitors: number; views: number; leads: number; demos: number; clients: number }[];
}
export interface SiteNumbers {
  now: SiteFigures;
  before: SiteFigures;
  last30: { day: string; visitors: number }[];
}
