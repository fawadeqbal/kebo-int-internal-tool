import { can, TRANSLATION_SHOWS, type TranslationShow, type TranslationView, type TranslatorStatus } from "@kebo/shared";
import { Badge, Card, CardBody, CardHeader, LinkTabs, PageHeader, Pager, RULES } from "@kebo/ui";
import { api } from "@/lib/api";
import { crumbsFor, labelFor } from "@/lib/nav";
import { requirePermission, requireUser } from "@/lib/session";
import { getSettings } from "@/lib/loaders";
import { SettingsCards } from "../cards";
import { saveSettingsAction } from "../actions";
import { TranslationList } from "./list";

export const metadata = { title: "Chinese on papers · Settings" };

const HREF = "/settings/translations";
const SHOW_WORD: Record<TranslationShow, string> = { check: "To check", waiting: "Being written", failed: "Not written", all: "All" };
const STATE: Record<TranslatorStatus["state"], { word: string; tone: "ok" | "warn" | "bad" | "neutral"; say: string }> = {
  ready: { word: "Ready", tone: "ok", say: "Each text is written in a few seconds, once, and kept." },
  starting: { word: "Starting", tone: "warn", say: "It is loading its model (the first time it also downloads it, about 1 GB). Texts wait until it is ready." },
  unreachable: { word: "Not reachable", tone: "bad", say: "The server's translator does not answer. Texts wait; papers print the English until it is back." },
  off: { word: "Off", tone: "neutral", say: "This server has no translator set up (TRANSLATE_URL). Papers print the labels' Chinese and the names people type." },
};

/**
 * Settings › Chinese on papers (25 Nov 2026): the translator on our own server (Tencent's Hy-MT2 translation
 * model: nothing is sent out), the company's own words for it, and its texts to check. Papers in English + 中文
 * print the Chinese as soon as it is written; a person's Chinese always wins.
 */
export default async function TranslationsPage({ searchParams }: { searchParams: Promise<{ show?: string; page?: string; size?: string }> }) {
  await requirePermission("documents.manage");
  const sp = await searchParams;
  const show: TranslationShow = (TRANSLATION_SHOWS as readonly string[]).includes(sp.show ?? "") ? (sp.show as TranslationShow) : "check";
  const page = Math.max(1, Number(sp.page) || 1);
  const size = [25, 50, 100].includes(Number(sp.size)) ? Number(sp.size) : 25;
  const [me, status, list] = await Promise.all([
    requireUser(),
    api.get<TranslatorStatus>("/translations/status"),
    api.get<{ total: number; rows: TranslationView[]; pageSize: number }>("/translations", { show, page: String(page), pageSize: String(size) }),
  ]);
  const st = STATE[status.state];
  const counts: Record<TranslationShow, number> = { ...status.counts, all: status.counts.done + status.counts.waiting + status.counts.failed };
  const words = can(me, "settings.manage") ? await getSettings() : null;
  return (
    <div className={RULES.page.column}>
      <PageHeader crumbs={crumbsFor(HREF)} title={labelFor(HREF)} />
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              The translator <Badge tone={st.tone}>{st.word}</Badge>
            </span>
          }
          description={`Tencent's Hy-MT2 translation model, on this server: nothing is sent out. ${st.say}`}
        />
        <CardBody className="text-md text-text-2">
          English typed in the app (items, terms, notes) is written in Chinese for papers in English + 中文, under the English. A person checks
          what it wrote: Right, or type the right one (the same item on the next order gets it).
        </CardBody>
      </Card>
      {words && (
        <SettingsCards groupKey="translation" values={words.translation as Record<string, unknown>} action={saveSettingsAction.bind(null, "translation")} currencyLocked={null} />
      )}
      <Card>
        <CardHeader title="Its texts" description="The newest first. Checked ones are kept as they are." />
        <CardBody className="flex flex-col gap-3">
          <LinkTabs
            label="Which texts"
            tabs={TRANSLATION_SHOWS.map((k) => ({ href: `${HREF}?show=${k}`, label: SHOW_WORD[k], count: counts[k], active: k === show }))}
          />
          {list.rows.length ? (
            <TranslationList rows={list.rows} />
          ) : (
            <p className="py-6 text-center text-md text-muted">
              {show === "check" ? "Nothing to check: every Chinese the translator wrote has been checked." : "None."}
            </p>
          )}
          <Pager base={HREF} params={{ show }} page={page} pageSize={size} total={list.total} />
        </CardBody>
      </Card>
    </div>
  );
}
