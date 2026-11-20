import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COLOUR_SETS, type ColourSet } from "@kebo/shared";

/**
 * The app's colours (Company settings › The app's colours): every set, light and dark, read from the theme
 * itself. Each set defines every colour token, and every pair of words and what is behind them, as the app
 * draws them, passes WCAG AA (4.5:1 for words, 3:1 for chart colours). A new set or a changed colour that
 * breaks this fails here, before it can go live.
 */
// Tests run in apps/web.
const CSS = readFileSync(resolve(process.cwd(), "../../packages/ui/src/styles/theme.css"), "utf8");
type Mode = "light" | "dark";
type Palette = Record<string, string>;

/** The block (selectors and declarations) a preview of a set uses: `[data-colours="graphite"][data-mode="dark"]`. */
function block(set: ColourSet, mode: Mode): { selectors: string; tokens: Palette } {
  const at = CSS.indexOf(`[data-colours="${set}"][data-mode="${mode}"]`);
  if (at < 0) throw new Error(`theme.css has no ${set} ${mode} block`);
  const open = CSS.indexOf("{", at);
  const close = CSS.indexOf("}", open);
  const tokens: Palette = {};
  for (const m of CSS.slice(open + 1, close).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) tokens[m[1]!] = m[2]!.trim();
  // Its selectors: what comes after the rule (or the at-rule line) before it, without comments.
  const before = CSS.slice(CSS.lastIndexOf("}", at) + 1, open).replace(/\/\*[\s\S]*?\*\//g, "");
  return { selectors: before.slice(Math.max(before.lastIndexOf(";"), before.lastIndexOf("}")) + 1).trim(), tokens };
}

const GREEN_LIGHT = block("green", "light").tokens;
const GREEN_DARK = block("green", "dark").tokens;
/** Shared by every set: the focus ring, the shadows and the chart colours (one set per mode). */
const SHARED = /^--(ring|shadow|shadow-lg|chart-\d)$/;
const COLOUR_TOKENS = Object.keys(GREEN_LIGHT).filter((t) => !SHARED.test(t));

/** What the page has in a set and mode: the defaults (light, then dark), then the set's own. */
function palette(set: ColourSet, mode: Mode): Palette {
  const base = mode === "light" ? GREEN_LIGHT : { ...GREEN_LIGHT, ...GREEN_DARK };
  return set === "green" ? base : { ...base, ...block(set, mode).tokens };
}

function luminance(hex: string) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

/** [what, the words' token (or a colour), the token behind them, what it must reach]. */
const PAIRS: [string, string, string, number][] = [
  ["text on the ground", "--text", "--bg", 4.5],
  ["text on cards", "--text", "--surface", 4.5],
  ["text on grey rows", "--text", "--surface-2", 4.5],
  ["text on chips", "--text", "--surface-3", 4.5],
  ["text on table heads", "--text", "--faint", 4.5],
  ["second text on the ground", "--text-2", "--bg", 4.5],
  ["second text on cards", "--text-2", "--surface", 4.5],
  ["second text on grey rows", "--text-2", "--surface-2", 4.5],
  ["second text on chips", "--text-2", "--surface-3", 4.5],
  ["grey labels on the ground", "--muted", "--bg", 4.5],
  ["grey labels on cards", "--muted", "--surface", 4.5],
  ["grey labels on grey rows", "--muted", "--surface-2", 4.5],
  ["grey labels on table heads", "--muted", "--faint", 4.5],
  ["grey labels on chips", "--muted", "--surface-3", 4.5],
  ["links on the ground", "--primary", "--bg", 4.5],
  ["links on cards", "--primary", "--surface", 4.5],
  ["links on grey rows", "--primary", "--surface-2", 4.5],
  ["a link under the pointer", "--primary-hover", "--surface", 4.5],
  ["the page you are on", "--primary", "--primary-soft", 4.5],
  ["white on the filled button", "--primary-fg", "--primary-solid", 4.5],
  ["… under the pointer", "--primary-fg", "--primary-solid-hover", 4.5],
  ["white on the main (orange) button", "#ffffff", "--action-solid", 4.5],
  ["… under the pointer", "#ffffff", "--action-solid-hover", 4.5],
  ["white on the delete button", "#ffffff", "--bad-solid", 4.5],
  ["done on its badge", "--ok", "--ok-soft", 4.5],
  ["done on cards", "--ok", "--surface", 4.5],
  ["waiting on its badge", "--warn", "--warn-soft", 4.5],
  ["waiting on cards", "--warn", "--surface", 4.5],
  ["late on its badge", "--bad", "--bad-soft", 4.5],
  ["late on cards", "--bad", "--surface", 4.5],
  ["sent on its badge", "--info", "--info-soft", 4.5],
  ["sent on the ground", "--info", "--bg", 4.5],
  ["orange words on cards", "--action", "--surface", 4.5],
  ["orange words on their badge", "--action", "--action-soft", 4.5],
  ["money words on their badge", "--money", "--money-soft", 4.5],
  ["teal words on their badge", "--trust", "--trust-soft", 4.5],
  ["the note's words", "--note-fg", "--note", 4.5],
  ["the note's second item", "--note-sub", "--note", 4.5],
  ["the note's Undo and links", "--note-link", "--note", 4.5],
  ["chart 1 on cards", "--chart-1", "--surface", 3],
  ["chart 2 on cards", "--chart-2", "--surface", 3],
  ["chart 3 on cards", "--chart-3", "--surface", 3],
  ["chart 4 on cards", "--chart-4", "--surface", 3],
  ["chart 5 on cards", "--chart-5", "--surface", 3],
];

const EVERY = COLOUR_SETS.flatMap((set) => (["light", "dark"] as const).map((mode) => [set, mode] as const));

describe("the app's colour sets", () => {
  it("are the eight the company can choose, Green first (the default)", () => {
    expect(COLOUR_SETS).toEqual(["green", "graphite", "midnight", "warm", "clay", "teal", "ink", "onyx"]);
  });

  it.each(EVERY)("%s %s: the page and its preview take the same block", (set, mode) => {
    const { selectors } = block(set, mode);
    // Green is the page's own (":root {" and ".dark {", last, as apps/app-v2/gen reads them).
    if (set === "green") expect(selectors.split(/\s*,\s*/).at(-1)).toBe(mode === "light" ? ":root" : ".dark");
    else expect(selectors).toContain(`${mode === "dark" ? ":root.dark" : ":root"}:has(#app-colours[data-colours="${set}"])`);
  });

  it.each(EVERY)("%s %s defines every colour token, as a #hex colour", (set, mode) => {
    const own = block(set, mode).tokens;
    for (const t of COLOUR_TOKENS) {
      expect(own[t], `${set} ${mode} ${t}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it.each(EVERY)("%s %s: every pair passes WCAG AA", (set, mode) => {
    const p = palette(set, mode);
    const failing = PAIRS.flatMap(([what, fg, bg, need]) => {
      const ratio = contrast(fg.startsWith("#") ? fg : p[fg]!, p[bg]!);
      return ratio < need ? [`${what}: ${ratio.toFixed(2)} (needs ${need})`] : [];
    });
    expect(failing).toEqual([]);
  });
});
