import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/** The API's source, its modules, and the shared package: what the guard tests read. */
export const SRC = resolve(__dirname, "../src");
export const MODULES = resolve(SRC, "modules");
export const SHARED = resolve(__dirname, "../../../packages/shared/src");

/** Every .ts file under `dir`, at any depth (the one walk the guard tests share). */
export function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? tsFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}
