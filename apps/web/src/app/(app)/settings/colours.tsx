"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { COLOUR_SET_LABEL, COLOUR_SETS, type ColourSet } from "@kebo/shared";
import { Card, CardBody, CardHeader, cn, Select } from "@kebo/ui";
import { toast } from "@kebo/ui/client";
import type { ActionState } from "@/lib/actions";

/** The app frame's marker (app layout): the page takes the colours it names (packages/ui/src/styles/theme.css). */
export const COLOURS_MARK = "app-colours";

/** What each set looks like, in a line. */
const SET_LINE: Record<ColourSet, string> = {
  green: "Light green-grey with green. As it has always been.",
  graphite: "Plain greys, no tint. Green only where it means something.",
  midnight: "Cool blue-grey with blue links and buttons.",
  warm: "Warm paper greys with copper links.",
  clay: "Warm paper with terracotta. Near-black warm charcoal in dark.",
  teal: "Fresh green-blue greys with teal. Near-black in dark.",
  ink: "Soft greys with charcoal, no colour. Black with light grey in dark.",
  onyx: "Pure white and black. Pure black with white in dark.",
};

/** The whole app in these colours, at once (the frame's marker; the saved choice follows). */
function show(set: ColourSet) {
  document.getElementById(COLOURS_MARK)?.setAttribute("data-colours", set);
}

/** A small app in a set's colours, light or dark: the menu, a card with words, a link, two badges and the two buttons. */
function Mini({ set, mode }: { set: ColourSet; mode: "light" | "dark" }) {
  const bar = "block h-[5px] rounded-[3px]";
  return (
    <span data-colours={set} data-mode={mode} aria-hidden className="flex h-[104px] overflow-hidden rounded-[9px] border border-line-strong bg-bg">
      <span className="flex w-[30%] flex-col gap-[5px] border-r border-line bg-surface px-[5px] py-[7px]">
        <span className={cn(bar, "w-3/5 bg-primary-solid")} />
        <span className={cn(bar, "bg-line-strong")} />
        <span className="block h-[9px] rounded-[3px] bg-primary-soft" />
        <span className={cn(bar, "bg-line-strong")} />
        <span className={cn(bar, "w-[70%] bg-line-strong")} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[5px] p-[7px]">
        <span className="block h-2 rounded-[3px] border border-line bg-surface" />
        <span className="flex flex-col gap-[5px] rounded-md border border-line bg-surface p-1.5">
          <span className={cn(bar, "w-[55%] bg-text")} />
          <span className={cn(bar, "w-4/5 bg-muted opacity-55")} />
          <span className={cn(bar, "w-2/5 bg-primary")} />
          <span className="flex gap-1">
            <span className="block h-[9px] w-[30px] rounded-[5px] border border-ok bg-ok-soft" />
            <span className="block h-[9px] w-[30px] rounded-[5px] border border-warn bg-warn-soft" />
          </span>
          <span className="mt-0.5 flex gap-1">
            <span className="block h-[9px] w-[26px] rounded-[3px] bg-primary-solid" />
            <span className="block h-[9px] w-[26px] rounded-[3px] border border-line-strong bg-surface" />
          </span>
        </span>
      </span>
    </span>
  );
}

/**
 * Company settings › The app's colours: a dropdown of the sets, and the chosen one drawn light and dark as it
 * really is. Choosing one shows it on the whole app at once and saves it for everyone in the company (arrowing
 * through the dropdown saves only where it stops); the note says so, with Undo. Each person still picks light, dark
 * or auto under their name.
 */
export function ColoursCard({
  title,
  description,
  value,
  save,
}: {
  title: string;
  description: string;
  value: ColourSet;
  save: (set: ColourSet) => Promise<ActionState>;
}) {
  const router = useRouter();
  // Shown (the page's colours and the checked choice) and saved (what the company has, as far as this page knows).
  const [chosen, setChosen] = useState<ColourSet>(value);
  const [saved, setSaved] = useState<ColourSet>(value);
  // The page comes back with the company's value after a save, or someone else's change: it wins.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setSaved(value);
    setChosen(value);
  }
  const wait = useRef<number | undefined>(undefined);
  // The colours saved before this run of choices (arrowing through the dropdown is one change).
  const from = useRef<ColourSet>(value);

  const back = (set: ColourSet) => {
    show(set);
    setChosen(set);
  };

  const commit = async (set: ColourSet, before: ColourSet) => {
    if (set === before) return;
    const r = await save(set);
    if (r.ok === false) {
      back(before);
      toast({ kind: "fail", message: r.message ?? "The colours did not change. Try again." });
      return;
    }
    setSaved(set);
    toast({
      message: `The app's colours are now ${COLOUR_SET_LABEL[set]}`,
      detail: "For everyone in the company",
      undo: async () => {
        back(before);
        const u = await save(before);
        if (u.ok === false) {
          back(set);
          throw new Error(u.message ?? "The colours did not change back.");
        }
        setSaved(before);
        router.refresh();
      },
    });
    router.refresh();
  };

  const choose = (set: ColourSet) => {
    if (wait.current === undefined) from.current = saved;
    else window.clearTimeout(wait.current);
    show(set);
    setChosen(set);
    const before = from.current;
    wait.current = window.setTimeout(() => {
      wait.current = undefined;
      void commit(set, before);
    }, 450);
  };

  return (
    <Card id="colours" className="scroll-mt-20">
      <CardHeader title={title} description={description} />
      <CardBody className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-5">
          <div className="flex min-w-0 flex-col gap-1.5 sm:w-64">
            <label htmlFor="colours-set" className="text-sm font-medium text-text">
              Colours
            </label>
            <Select id="colours-set" name="colours" value={chosen} onChange={(e) => choose(e.target.value as ColourSet)} aria-describedby="colours-line">
              {COLOUR_SETS.map((set) => (
                <option key={set} value={set}>
                  {COLOUR_SET_LABEL[set]}
                  {set === "green" ? " (Default)" : ""}
                </option>
              ))}
            </Select>
            <p id="colours-line" className="text-xs leading-snug text-text-2">
              {SET_LINE[chosen]}
            </p>
          </div>
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5 sm:max-w-md">
            <Mini set={chosen} mode="light" />
            <Mini set={chosen} mode="dark" />
            <span aria-hidden className="text-center text-2xs text-muted">
              Light
            </span>
            <span aria-hidden className="text-center text-2xs text-muted">
              Dark
            </span>
          </div>
        </div>
        <p className="flex items-start gap-2.5 rounded-xl bg-surface-2 px-3.5 py-3 text-md text-text-2">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Each person still chooses <strong className="font-semibold text-text">Light</strong>, <strong className="font-semibold text-text">Dark</strong> or{" "}
            <strong className="font-semibold text-text">Auto</strong> for themselves, in the menu under their name.
          </span>
        </p>
      </CardBody>
    </Card>
  );
}
