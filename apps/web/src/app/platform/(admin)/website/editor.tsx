"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { SITE_ICONS, siteContent, type SiteContent, type SiteIcon } from "@kebo/shared";
import { Button, Card, CardBody, CardHeader, Checkbox, cn, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { SITE_ICON } from "@/components/site/icons";
import type { SitePlan } from "@/components/site/marketing";
import { saveSiteAction } from "./actions";

type Errors = Record<string, string>;

/** Problems with the page, by field ("features.items.2.title"), checked with the same rules as the server. */
function problems(c: SiteContent): Errors {
  const r = siteContent.safeParse(c);
  if (r.success) return {};
  const out: Errors = {};
  for (const i of r.error.issues) {
    const k = i.path.join(".");
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

const SECTIONS = [
  { id: "top", label: "Top of the page" },
  { id: "features", label: "Features" },
  { id: "steps", label: "How it works" },
  { id: "plans", label: "Plans" },
  { id: "quotes", label: "Customer words" },
  { id: "faq", label: "Questions" },
  { id: "closing", label: "Closing and contact" },
  { id: "seo", label: "Search and sharing" },
];

/**
 * The marketing page's words, section by section. Saving keeps a draft; the
 * live page changes only when the draft is published.
 */
export function SiteEditor({ initial, plans }: { initial: SiteContent; plans: SitePlan[] }) {
  const [c, setC] = useState<SiteContent>(initial);
  const [tried, setTried] = useState(false);
  const errors = useMemo(() => (tried ? problems(c) : {}), [c, tried]);
  const dirty = JSON.stringify(c) !== JSON.stringify(initial);
  const set = <K extends keyof SiteContent>(k: K, v: SiteContent[K]) => setC((x) => ({ ...x, [k]: v }));
  const err = (k: string) => (errors[k] ? [errors[k]] : undefined);

  return (
    <ActionForm action={saveSiteAction} className="flex flex-col gap-5" keepFields>
      <input type="hidden" name="draft" value={JSON.stringify(c)} />
      <nav aria-label="Page sections" className="flex flex-wrap gap-1.5">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#site-${s.id}`} className="rounded-md border border-line px-2.5 py-1 text-sm text-text-2 hover:bg-surface-2">
            {s.label}
          </a>
        ))}
      </nav>

      <Section id="top" title="Top of the page" description="The first thing visitors read: what RFQ Desk is, and the main button.">
        <Grid>
          <Field label="Small line above the headline" htmlFor="h-eyebrow" optional error={err("hero.eyebrow")}>
            <Input
              id="h-eyebrow"
              value={c.hero.eyebrow ?? ""}
              maxLength={80}
              onChange={(e) => set("hero", { ...c.hero, eyebrow: e.target.value })}
            />
          </Field>
          <Field
            label="Main button"
            htmlFor="h-primary"
            error={err("hero.primary")}
            hint="Opens the demo request; also used at the top right and at the end."
          >
            <Input
              id="h-primary"
              value={c.hero.primary}
              maxLength={40}
              onChange={(e) => set("hero", { ...c.hero, primary: e.target.value })}
            />
          </Field>
        </Grid>
        <Field label="Headline" htmlFor="h-title" error={err("hero.title")}>
          <Input id="h-title" value={c.hero.title} maxLength={120} onChange={(e) => set("hero", { ...c.hero, title: e.target.value })} />
        </Field>
        <Field label="Under the headline" htmlFor="h-sub" error={err("hero.subtitle")}>
          <Textarea
            id="h-sub"
            rows={3}
            value={c.hero.subtitle}
            maxLength={400}
            onChange={(e) => set("hero", { ...c.hero, subtitle: e.target.value })}
          />
        </Field>
        <Field
          label="Second button"
          htmlFor="h-second"
          optional
          error={err("hero.secondary")}
          hint="Goes to the plans (or the features when plans are hidden)."
        >
          <Input
            id="h-second"
            value={c.hero.secondary ?? ""}
            maxLength={40}
            onChange={(e) => set("hero", { ...c.hero, secondary: e.target.value })}
          />
        </Field>
      </Section>

      <Section id="features" title="Features" description="What RFQ Desk does, in a few blocks. Up to 12.">
        <Grid>
          <Field label="Section title" htmlFor="f-title" error={err("features.title")}>
            <Input id="f-title" value={c.features.title} onChange={(e) => set("features", { ...c.features, title: e.target.value })} />
          </Field>
          <Field label="Line under it" htmlFor="f-sub" optional error={err("features.subtitle")}>
            <Input
              id="f-sub"
              value={c.features.subtitle ?? ""}
              onChange={(e) => set("features", { ...c.features, subtitle: e.target.value })}
            />
          </Field>
        </Grid>
        <List
          items={c.features.items}
          max={12}
          addLabel="Add a feature"
          empty={{ icon: "inbox" as SiteIcon, title: "", text: "" }}
          onChange={(items) => set("features", { ...c.features, items })}
          render={(f, i, update) => (
            <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <Field label="Icon" htmlFor={`f-${i}-icon`}>
                <Select id={`f-${i}-icon`} value={f.icon} onChange={(e) => update({ ...f, icon: e.target.value as SiteIcon })}>
                  {SITE_ICONS.map((k) => (
                    <option key={k} value={k}>
                      {SITE_ICON[k].label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Title" htmlFor={`f-${i}-title`} error={err(`features.items.${i}.title`)}>
                <Input id={`f-${i}-title`} value={f.title} maxLength={80} onChange={(e) => update({ ...f, title: e.target.value })} />
              </Field>
              <Field label="Text" htmlFor={`f-${i}-text`} error={err(`features.items.${i}.text`)} className="sm:col-span-2">
                <Textarea
                  id={`f-${i}-text`}
                  rows={2}
                  value={f.text}
                  maxLength={300}
                  onChange={(e) => update({ ...f, text: e.target.value })}
                />
              </Field>
            </div>
          )}
        />
      </Section>

      <Section
        id="steps"
        title="How it works"
        description="The steps from first contact to working in RFQ Desk, in order. Up to 6; none hides the section."
      >
        <Field label="Section title" htmlFor="s-title" error={err("steps.title")}>
          <Input id="s-title" value={c.steps.title} onChange={(e) => set("steps", { ...c.steps, title: e.target.value })} />
        </Field>
        <List
          items={c.steps.items}
          max={6}
          numbered
          addLabel="Add a step"
          empty={{ title: "", text: "" }}
          onChange={(items) => set("steps", { ...c.steps, items })}
          render={(s, i, update) => (
            <div className="grid gap-3">
              <Field label="Title" htmlFor={`s-${i}-title`} error={err(`steps.items.${i}.title`)}>
                <Input id={`s-${i}-title`} value={s.title} maxLength={80} onChange={(e) => update({ ...s, title: e.target.value })} />
              </Field>
              <Field label="Text" htmlFor={`s-${i}-text`} error={err(`steps.items.${i}.text`)}>
                <Textarea
                  id={`s-${i}-text`}
                  rows={2}
                  value={s.text}
                  maxLength={300}
                  onChange={(e) => update({ ...s, text: e.target.value })}
                />
              </Field>
            </div>
          )}
        />
      </Section>

      <Section
        id="plans"
        title="Plans"
        description="Prices, limits and features come from the plans themselves (Plans in the menu): change them there and the page follows."
      >
        <label className="flex items-center gap-2.5 text-sm font-medium">
          <Checkbox checked={c.plans.show} onChange={(e) => set("plans", { ...c.plans, show: e.target.checked })} />
          Show the plans on the page
        </label>
        <Grid>
          <Field label="Section title" htmlFor="p-title" error={err("plans.title")}>
            <Input id="p-title" value={c.plans.title} onChange={(e) => set("plans", { ...c.plans, title: e.target.value })} />
          </Field>
          <Field label="Line under it" htmlFor="p-sub" optional error={err("plans.subtitle")}>
            <Input id="p-sub" value={c.plans.subtitle ?? ""} onChange={(e) => set("plans", { ...c.plans, subtitle: e.target.value })} />
          </Field>
        </Grid>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Which plans show</legend>
          {plans.length === 0 ? (
            <p className="text-sm text-muted">No active plans yet. Make them under Plans.</p>
          ) : (
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {plans.map((p) => (
                <li key={p.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={!c.plans.hidden.includes(p.id)}
                      onChange={(e) =>
                        set("plans", {
                          ...c.plans,
                          hidden: e.target.checked ? c.plans.hidden.filter((h) => h !== p.id) : [...c.plans.hidden, p.id],
                        })
                      }
                    />
                    {p.name}{" "}
                    <span className="text-muted">
                      ({p.currency} {p.price})
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
        <Field label="Note under the plans" htmlFor="p-note" optional error={err("plans.note")}>
          <Input id="p-note" value={c.plans.note ?? ""} onChange={(e) => set("plans", { ...c.plans, note: e.target.value })} />
        </Field>
      </Section>

      <Section
        id="quotes"
        title="Customer words"
        description="Only real words from real customers, with their permission. Up to 6; none hides the section."
      >
        <List
          items={c.quotes}
          max={6}
          addLabel="Add what a customer said"
          empty={{ text: "", name: "", role: null, company: "" }}
          onChange={(quotes) => set("quotes", quotes)}
          render={(q, i, update) => (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="What they said" htmlFor={`q-${i}-text`} error={err(`quotes.${i}.text`)} className="sm:col-span-3">
                <Textarea
                  id={`q-${i}-text`}
                  rows={2}
                  value={q.text}
                  maxLength={500}
                  onChange={(e) => update({ ...q, text: e.target.value })}
                />
              </Field>
              <Field label="Name" htmlFor={`q-${i}-name`} error={err(`quotes.${i}.name`)}>
                <Input id={`q-${i}-name`} value={q.name} onChange={(e) => update({ ...q, name: e.target.value })} />
              </Field>
              <Field label="Their role" htmlFor={`q-${i}-role`} optional>
                <Input id={`q-${i}-role`} value={q.role ?? ""} onChange={(e) => update({ ...q, role: e.target.value })} />
              </Field>
              <Field label="Company" htmlFor={`q-${i}-company`} error={err(`quotes.${i}.company`)}>
                <Input id={`q-${i}-company`} value={q.company} onChange={(e) => update({ ...q, company: e.target.value })} />
              </Field>
            </div>
          )}
        />
      </Section>

      <Section id="faq" title="Questions" description="What people ask before they buy. Up to 20; none hides the section.">
        <Field label="Section title" htmlFor="q-title" error={err("faq.title")}>
          <Input id="q-title" value={c.faq.title} onChange={(e) => set("faq", { ...c.faq, title: e.target.value })} />
        </Field>
        <List
          items={c.faq.items}
          max={20}
          addLabel="Add a question"
          empty={{ q: "", a: "" }}
          onChange={(items) => set("faq", { ...c.faq, items })}
          render={(f, i, update) => (
            <div className="grid gap-3">
              <Field label="Question" htmlFor={`faq-${i}-q`} error={err(`faq.items.${i}.q`)}>
                <Input id={`faq-${i}-q`} value={f.q} maxLength={200} onChange={(e) => update({ ...f, q: e.target.value })} />
              </Field>
              <Field label="Answer" htmlFor={`faq-${i}-a`} error={err(`faq.items.${i}.a`)}>
                <Textarea id={`faq-${i}-a`} rows={3} value={f.a} maxLength={1500} onChange={(e) => update({ ...f, a: e.target.value })} />
              </Field>
            </div>
          )}
        />
      </Section>

      <Section
        id="closing"
        title="Closing and contact"
        description="The last band of the page, next to the question form. Contact details show only when filled in."
      >
        <Field label="Closing headline" htmlFor="c-title" error={err("cta.title")}>
          <Input id="c-title" value={c.cta.title} maxLength={120} onChange={(e) => set("cta", { ...c.cta, title: e.target.value })} />
        </Field>
        <Field label="Line under it" htmlFor="c-text" optional error={err("cta.text")}>
          <Input id="c-text" value={c.cta.text ?? ""} maxLength={300} onChange={(e) => set("cta", { ...c.cta, text: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Email" htmlFor="c-email" optional error={err("contact.email")}>
            <Input
              id="c-email"
              type="email"
              value={c.contact.email ?? ""}
              onChange={(e) => set("contact", { ...c.contact, email: e.target.value })}
            />
          </Field>
          <Field label="WhatsApp" htmlFor="c-wa" optional hint="With the country code, e.g. +92 300 1234567">
            <Input
              id="c-wa"
              value={c.contact.whatsapp ?? ""}
              onChange={(e) => set("contact", { ...c.contact, whatsapp: e.target.value })}
            />
          </Field>
          <Field label="Phone" htmlFor="c-phone" optional>
            <Input id="c-phone" value={c.contact.phone ?? ""} onChange={(e) => set("contact", { ...c.contact, phone: e.target.value })} />
          </Field>
        </div>
      </Section>

      <Section
        id="seo"
        title="Search and sharing"
        description="What Google shows, and what appears when the link is shared on WhatsApp or LinkedIn."
      >
        <Field label="Page title" htmlFor="seo-title" error={err("seo.title")} hint={`${c.seo.title.length} of 70 characters`}>
          <Input id="seo-title" value={c.seo.title} maxLength={70} onChange={(e) => set("seo", { ...c.seo, title: e.target.value })} />
        </Field>
        <Field label="Description" htmlFor="seo-desc" error={err("seo.description")} hint={`${c.seo.description.length} of 200 characters`}>
          <Textarea
            id="seo-desc"
            rows={2}
            value={c.seo.description}
            maxLength={200}
            onChange={(e) => set("seo", { ...c.seo, description: e.target.value })}
          />
        </Field>
        <Field
          label="Picture when shared"
          htmlFor="seo-image"
          optional
          error={err("seo.image")}
          hint="A full https:// address of an image, 1200 × 630 works best."
        >
          <Input id="seo-image" value={c.seo.image ?? ""} onChange={(e) => set("seo", { ...c.seo, image: e.target.value })} />
        </Field>
      </Section>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface/95 px-1 py-3 backdrop-blur">
        <p className="text-sm text-muted" aria-live="polite">
          {Object.keys(errors).length
            ? `${Object.keys(errors).length} field${Object.keys(errors).length === 1 ? " needs" : "s need"} a look (marked in red).`
            : dirty
              ? "Changes not saved yet."
              : "No changes since the last save."}
        </p>
        <SubmitButton
          pendingText="Saving…"
          disabled={!dirty}
          onClick={(e) => {
            setTried(true);
            if (Object.keys(problems(c)).length) e.preventDefault();
          }}
        >
          Save the draft
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

function Section({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <Card id={`site-${id}`} className="scroll-mt-20">
      <CardHeader title={title} description={description} />
      <CardBody className="flex flex-col gap-4">{children}</CardBody>
    </Card>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

/** Blocks that can be added, removed and moved up or down. */
function List<T>({
  items,
  max,
  empty,
  addLabel,
  numbered = false,
  onChange,
  render,
}: {
  items: T[];
  max: number;
  empty: T;
  addLabel: string;
  numbered?: boolean;
  onChange: (items: T[]) => void;
  render: (item: T, i: number, update: (v: T) => void) => ReactNode;
}) {
  const move = (i: number, d: -1 | 1) => {
    const next = [...items];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-3">
      {items.map((item, i) => (
        <div key={i} className="rounded-lg border border-line p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-text-2">{numbered ? `Step ${i + 1}` : `${i + 1} of ${items.length}`}</p>
            <div className="flex gap-1">
              <Button type="button" variant="ghost" size="sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Move down"
                disabled={i === items.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown aria-hidden />
              </Button>
              <Button type="button" variant="ghost" size="sm" aria-label="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}>
                <Trash2 aria-hidden />
              </Button>
            </div>
          </div>
          {render(item, i, (v) => onChange(items.map((x, j) => (j === i ? v : x))))}
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={items.length >= max}
          onClick={() => onChange([...items, empty])}
          className={cn(items.length >= max && "opacity-60")}
        >
          <Plus aria-hidden /> {addLabel}
        </Button>
      </div>
    </div>
  );
}
