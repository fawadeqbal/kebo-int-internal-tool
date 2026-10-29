/**
 * CI: the migrations added by this change come after every migration on the base, and are
 * named the way Prisma names them; none on the base was removed or renamed. See README.md.
 *
 *   tsx scripts/check-migrations.ts [base]     base: a commit or branch (default origin/main)
 *
 * Migrations whose migration.sql changed are listed too: one already applied must not be edited.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { migrationProblems } from "./migration-order";

const DIR = "packages/database/prisma/migrations";
const base = process.argv[2] || "origin/main";
const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
// From the repository's top, so the paths below mean the same wherever this is run from.
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", cwd: top }).trim();

const folders = (list: string[]) => list.filter((n) => n !== "migration_lock.toml");
const before = folders(git("ls-tree", "--name-only", `${base}:${DIR}`).split("\n").filter(Boolean));
const dir = path.join(top, DIR);
const after = folders(readdirSync(dir).filter((n) => existsSync(path.join(dir, n, "migration.sql"))));
const problems = migrationProblems(before, after);
const edited = git("diff", "--name-only", base, "--", `${DIR}/*/migration.sql`)
  .split("\n")
  .filter((f) => f && before.includes(path.basename(path.dirname(f))));
for (const f of edited) problems.push(`${f} was changed: never edit a migration that is on main (add a new one).`);

if (problems.length) {
  console.error(`Migrations, against ${base}:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
console.log(`Migrations OK against ${base}: ${after.length - before.length} new, after ${before.sort().at(-1)}.`);
