/**
 * Seed: the starting accounts and settings; with --demo, sample deals at every
 * stage (for development only — refused against a non-local database).
 *
 *   pnpm db:seed            accounts + settings (safe to run again)
 *   pnpm db:seed --demo     plus sample customers, factories and deals
 */
import "./env";
import bcrypt from "bcryptjs";
import { createPrismaClient, seedCompanyBase, seedDemoData } from "../src";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const demo = process.argv.includes("--demo");
const slugArg = process.argv.indexOf("--company");
/** Which company to seed (its short name); the first company by default. */
const slug = slugArg > 0 ? process.argv[slugArg + 1] : process.env.SEED_COMPANY;
const owner = createPrismaClient({ url, poolSize: 2 });
const tz = process.env.APP_TIME_ZONE ?? "Asia/Shanghai";
const log = (m: string) => console.log(`[seed] ${m}`);

function assertLocal() {
  const host = new URL(url!).hostname;
  if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "db", "postgres"].includes(host)) {
    throw new Error("Demo data is only for a database on your own computer (its logins use a published password).");
  }
}

async function main() {
  const company = slug
    ? await owner.company.findUnique({ where: { slug } })
    : await owner.company.findFirst({ where: { status: { not: "deleted" } }, orderBy: { createdAt: "asc" } });
  if (!company) throw new Error(slug ? `No company "${slug}"` : "No company yet: run the migrations first (pnpm db:deploy)");
  log(`company ${company.slug} (${company.name})`);
  const db = createPrismaClient({ url: url!, poolSize: 2, companyId: company.id });
  try {
    const hash = (p: string) => bcrypt.hash(p, 12);
    const people = await seedCompanyBase(db, {
      admin: { email: process.env.SEED_ADMIN_EMAIL ?? "admin@example.com", name: process.env.SEED_ADMIN_NAME ?? "Super Admin", role: "admin", passwordHash: await hash(process.env.SEED_ADMIN_PASSWORD ?? "Admin@12345") },
      manager: { email: process.env.SEED_MANAGER_EMAIL ?? "manager@example.com", name: process.env.SEED_MANAGER_NAME ?? "Manager", role: "manager", passwordHash: await hash(process.env.SEED_MANAGER_PASSWORD ?? "Manager@12345") },
      staff: { email: process.env.SEED_STAFF_EMAIL ?? "staff@example.com", name: process.env.SEED_STAFF_NAME ?? "Staff", role: "staff", passwordHash: await hash(process.env.SEED_STAFF_PASSWORD ?? "Staff@12345") },
      log,
    });
    if (demo) {
      assertLocal();
      await seedDemoData(db, people, { timeZone: tz, samplePasswordHash: await hash("Demo@12345"), log });
      log("demo people bilal@example.com / sana@example.com, password Demo@12345");
    }
    log("done");
  } finally {
    await db.$disconnect();
  }
}

main()
  .catch((e) => {
    console.error("[seed] failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => owner.$disconnect());
