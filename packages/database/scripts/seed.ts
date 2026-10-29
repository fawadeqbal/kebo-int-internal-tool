/**
 * Seed: the starting accounts and settings; with --demo, sample deals at every
 * stage (for development only — refused against a non-local database).
 *
 *   pnpm db:seed            accounts + settings (safe to run again)
 *   pnpm db:seed --demo     plus sample customers, factories and deals
 *
 * In production (NODE_ENV=production) SEED_ADMIN_PASSWORD, SEED_MANAGER_PASSWORD
 * and SEED_STAFF_PASSWORD are required: the default passwords are refused there.
 */
import "./env";
import bcrypt from "bcryptjs";
import { createPrismaClient, scriptCompanyUrl, seedCompanyBase, seedDemoData } from "../src";
import { seedPeople } from "./seed-people";
import { KEBO_PROFILE } from "./kebo-profile";

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
  const db = createPrismaClient({ url: await scriptCompanyUrl(url!), poolSize: 2, companyId: company.id });
  try {
    const hash = (p: string) => bcrypt.hash(p, 12);
    const who = seedPeople(process.env);
    const people = await seedCompanyBase(db, {
      admin: { email: who.admin.email, name: who.admin.name, role: "admin", passwordHash: await hash(who.admin.password) },
      manager: { email: who.manager.email, name: who.manager.name, role: "manager", passwordHash: await hash(who.manager.password) },
      staff: { email: who.staff.email, name: who.staff.name, role: "staff", passwordHash: await hash(who.staff.password) },
      // The first company, Kebo, gets its real details; any other starts blank with its own name.
      ...(company.slug === "kebo" ? { profile: KEBO_PROFILE } : { companyName: company.name }),
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
