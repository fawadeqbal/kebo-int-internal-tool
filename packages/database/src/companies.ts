import { createPrismaClient, type PrismaClient } from "./client";
import { companyDatabaseUrl, prepareCompanyRole } from "./company-role";

/** The first company: the data that was there before companies existed (see the companies migration). */
export const FIRST_COMPANY_ID = "6b65626f-0000-4000-8000-000000000001";

/**
 * For scripts: where company connections log in (see company-role.ts), with the
 * company role made ready first. Reads AUTH_SECRET and COMPANY_DATABASE_URL from
 * the environment, like the API.
 */
export async function scriptCompanyUrl(ownerUrl: string, env: Record<string, string | undefined> = process.env): Promise<string> {
  if (env.COMPANY_DATABASE_URL?.trim()) return env.COMPANY_DATABASE_URL.trim();
  const secret = env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set: company connections need it (their database password is made from it)");
  await prepareCompanyRole(ownerUrl, secret);
  return companyDatabaseUrl(ownerUrl, secret);
}

/**
 * For scripts: the company with this short name (the first company when none is
 * given) and a connection that works inside it only. Disconnect both when done.
 */
export async function openCompany(url: string, slug?: string, poolSize = 4) {
  const owner = createPrismaClient({ url, poolSize: 2 });
  try {
    const company = slug
      ? await owner.company.findUnique({ where: { slug } })
      : await owner.company.findFirst({ where: { status: { not: "deleted" } }, orderBy: { createdAt: "asc" } });
    if (!company) throw new Error(slug ? `No company "${slug}"` : "No company yet: run the migrations first (pnpm db:deploy)");
    const db: PrismaClient = createPrismaClient({ url: await scriptCompanyUrl(url), poolSize, companyId: company.id });
    return { company, db };
  } finally {
    await owner.$disconnect();
  }
}
