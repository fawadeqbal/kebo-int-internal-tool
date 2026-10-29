/** The rules for migration folders (README.md "Migrations"); checked in CI by scripts/check-migrations.ts. */

/** Prisma's name: a 14-digit UTC timestamp (YYYYMMDDHHMMSS), "_", then lowercase words. */
export const MIGRATION_NAME = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_[a-z0-9]+(_[a-z0-9]+)*$/;

function validTimestamp(name: string) {
  const m = MIGRATION_NAME.exec(name);
  if (!m) return false;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return (
    t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d && t.getUTCHours() === h && t.getUTCMinutes() === mi
  );
}

/**
 * What is wrong with this change's migrations. `before`: the folders on the base (main),
 * `after`: the folders now. A migration is never renamed or removed once it is on main
 * (production has applied it), and a new one sorts after every one already there: Prisma
 * applies them in name order, and a database that already has the later ones would apply
 * the new one after them, in a different order from a fresh one.
 */
export function migrationProblems(before: string[], after: string[]): string[] {
  const problems: string[] = [];
  const now = new Set(after);
  const was = new Set(before);
  for (const name of before)
    if (!now.has(name)) problems.push(`${name} is on main but was removed or renamed: never change a migration production has applied.`);
  const latest = [...before].sort().at(-1);
  for (const name of after.filter((n) => !was.has(n)).sort()) {
    if (!validTimestamp(name)) problems.push(`${name}: not a Prisma migration name (YYYYMMDDHHMMSS_words, lowercase).`);
    else if (latest && name <= latest)
      problems.push(`${name} sorts before ${latest}, which is already on main: give it a later timestamp.`);
  }
  return problems;
}
