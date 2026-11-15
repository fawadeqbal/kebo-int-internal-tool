import fs from "node:fs";
import path from "node:path";

/** The web app's pages, read from its folders: a new page is checked without anyone adding it here. */
const APP_DIR = path.resolve(__dirname, "../../web/src/app");

/** Where the crawl writes the address it found for each page with an id in it (setup.ts), for pages.spec.ts. */
export const FOUND_FILE = path.resolve(__dirname, "../.auth/pages.json");
export const ADMIN_STATE = path.resolve(__dirname, "../.auth/admin.json");

export type Area = "app" | "print" | "public" | "platform";

export interface Route {
  /** As in the folders, without the (groups): "/orders/[id]/money". */
  route: string;
  area: Area;
  /** Has a [segment]: the address comes from a link found in the app. */
  dynamic: boolean;
  /** Only sends an old address on (redirect, nothing drawn): the page it lands on is the one checked. */
  forwards: boolean;
}

/**
 * Every page.tsx under src/app. Route groups "(app)" are dropped from the address; parallel slots (@window),
 * intercepted routes "(.)…" and catch-alls "[...rest]" are windows over another page, not pages of their own.
 */
export function appRoutes(): Route[] {
  const out: Route[] = [];
  const walk = (dir: string, segments: string[], area: Area | null) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name === "page.tsx") {
        const route = "/" + segments.join("/");
        const where: Area = area ?? (route.startsWith("/platform") ? "platform" : route.startsWith("/print") ? "print" : "public");
        const source = fs.readFileSync(path.join(dir, entry.name), "utf8");
        const forwards = /\bredirect\(/.test(source) && !/\breturn\b/.test(source);
        out.push({ route, area: where, dynamic: route.includes("["), forwards });
      }
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name.startsWith("@") || name.startsWith("(.") || name.startsWith("[...") || name.startsWith("_")) continue;
      const group = /^\(.+\)$/.test(name);
      walk(path.join(dir, name), group ? segments : [...segments, name], area ?? (name === "(app)" ? "app" : null));
    }
  };
  walk(APP_DIR, [], null);
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

/** "/orders/[id]/papers/[kind]" → a pattern for addresses like "/orders/5f…/papers/proforma". */
export function patternOf(route: string): RegExp {
  const body = route
    .split("/")
    .map((s) => (/^\[.+\]$/.test(s) ? "[^/]+" : s.replace(/[.*+?^${}()|\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${body}$`);
}

/** The page an address opens: a fixed page first (/orders/board), then the most specific page with ids. */
export function routeOf(address: string, routes: Route[]): Route | undefined {
  const exact = routes.find((r) => !r.dynamic && r.route === address);
  if (exact) return exact;
  const fixedParts = (r: Route) => r.route.split("/").filter((s) => s && !s.startsWith("[")).length;
  return routes
    .filter((r) => r.dynamic)
    .sort((a, b) => fixedParts(b) - fixedParts(a))
    .find((r) => patternOf(r.route).test(address));
}

export function foundPages(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(FOUND_FILE, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}
