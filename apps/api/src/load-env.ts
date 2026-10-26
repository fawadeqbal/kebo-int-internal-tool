import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * For local runs: read the nearest .env (the repo root's, from apps/api) into the
 * environment. Variables already set win, so Docker and CI, which set them and have
 * no .env file, are unaffected. Imported first by main.ts and worker.ts.
 */
for (let dir = process.cwd(); ; dir = dirname(dir)) {
  const file = join(dir, ".env");
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
  if (dirname(dir) === dir) break;
}
