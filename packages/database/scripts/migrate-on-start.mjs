// The API container's start (docker/api.Dockerfile): apply the migrations, then the API starts.
// A deploy (deploy/ci-deploy.sh) has applied them already, so this is a no-op then; it is here for
// a deploy by hand. Exits 1 (the API does not start) when this version's migrations are not all
// applied. One case starts anyway, with a warning: a migration of a NEWER version failed and this
// version's are all applied. That is a deploy that stopped at its migrations while this version kept
// running; it must be able to restart (a crash, a reboot) until the failed migration is dealt with.
//   node scripts/migrate-on-start.mjs        (from packages/database, DATABASE_URL set)
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const say = (m) => console.error(`[migrate] ${m}`);

const run = spawnSync("npx", ["prisma", "migrate", "deploy"], { cwd: root, stdio: "inherit" });
if (run.status === 0) process.exit(0);

const dir = path.join(root, "prisma", "migrations");
const mine = readdirSync(dir).filter((d) => existsSync(path.join(dir, d, "migration.sql")));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const { rows } = await client.query("select migration_name, finished_at, rolled_back_at from _prisma_migrations");
  const applied = new Set(rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name));
  const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
  const missing = mine.filter((m) => !applied.has(m));
  if (!missing.length && failed.length && failed.every((f) => !mine.includes(f))) {
    say(`WARNING: migration ${failed.join(", ")} of a newer version failed. This version's migrations are all applied, so it starts.`);
    say("Undo or finish that migration (docs/restore.md) before deploying again.");
    process.exit(0);
  }
  say(missing.length ? `not applied: ${missing.join(", ")}` : "the migrations could not be applied (see above)");
} catch (e) {
  say(`could not check the migrations: ${e instanceof Error ? e.message : e}`);
} finally {
  await client.end().catch(() => undefined);
}
process.exit(1);
