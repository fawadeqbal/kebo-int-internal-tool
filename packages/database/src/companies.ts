import { createPrismaClient, type PrismaClient } from "./client";

/** The first company: the data that was there before companies existed (see the companies migration). */
export const FIRST_COMPANY_ID = "6b65626f-0000-4000-8000-000000000001";

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
    const db: PrismaClient = createPrismaClient({ url, poolSize, companyId: company.id });
    return { company, db };
  } finally {
    await owner.$disconnect();
  }
}
