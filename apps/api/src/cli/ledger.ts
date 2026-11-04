/* eslint-disable no-console -- a command line tool: it prints its answers */
import "../load-env";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Module } from "@nestjs/common";
import { EnvModule } from "../config/env";
import { PrismaModule, PrismaService } from "../database/prisma.service";
import { CommonModule } from "../common/common.module";
import { CompaniesModule, toInfo } from "../common/company/companies.service";
import { LimitsModule } from "../common/company/limits.service";
import { CompanyContext } from "../common/company/company-context";
import { SettingsModule } from "../modules/settings/settings.module";
import { LedgerPosting, LedgerPostingModule } from "../modules/ledger/posting.service";
import { LedgerJobsModule } from "../modules/ledger/ledger.module";
import { LedgerService } from "../modules/ledger/ledger.service";

/**
 * The ledger from the command line (see docs/ledger.md):
 *
 *   node apps/api/dist/cli/ledger.js rebuild --all [--dry-run]          post every record not posted as it stands
 *   node apps/api/dist/cli/ledger.js rebuild --company <slug> [--dry-run]
 *   node apps/api/dist/cli/ledger.js rebuild --company <slug> --reset   remove the company's rows and post everything again
 *   node apps/api/dist/cli/ledger.js check --all | --company <slug>     the ledger against today's figures
 *
 * rebuild writes only what differs (running it twice writes nothing the second time). --dry-run works it all out
 * in one transaction and rolls it back. In Docker: docker compose exec -T api node apps/api/dist/cli/ledger.js …
 * Exits 1 when check finds a difference.
 */
@Module({
  imports: [EnvModule, PrismaModule, CompaniesModule, LimitsModule, CommonModule, LedgerPostingModule, SettingsModule, LedgerJobsModule],
})
class CliModule {}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const flag = (f: string) => args.includes(f);
  const value = (f: string) => {
    const i = args.indexOf(f);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const slug = value("--company");
  if ((cmd !== "rebuild" && cmd !== "check") || (!slug && !flag("--all")) || (flag("--reset") && !slug)) {
    console.log("Usage: ledger rebuild --all | --company <slug> [--dry-run] [--reset]\n       ledger check --all | --company <slug>");
    process.exitCode = 1;
    return;
  }
  const app = await NestFactory.createApplicationContext(CliModule, { logger: ["error", "warn"] });
  const prisma = app.get(PrismaService);
  const posting = app.get(LedgerPosting);
  const ledger = app.get(LedgerService);
  try {
    const companies = await prisma.platform.company.findMany({
      where: slug ? { slug } : { status: { not: "deleted" } },
      orderBy: { createdAt: "asc" },
    });
    if (!companies.length) throw new Error(slug ? `No company ${slug}` : "No companies");
    let differences = 0;
    for (const c of companies) {
      await CompanyContext.run(toInfo(c), async () => {
        if (cmd === "rebuild") {
          if (flag("--reset")) {
            await posting.reset();
            console.log(`${c.slug}: every ledger row removed; posting everything again`);
          }
          const started = Date.now();
          const r = await posting.syncAll({ dryRun: flag("--dry-run") });
          console.log(
            `${c.slug}${flag("--dry-run") ? " (dry run, nothing written)" : ""}: ${r.documents} documents; ${r.posted} posted, ${r.corrected} corrected, ${r.reversed} reversed; ${r.postings} postings, ${r.rows} rows (${((Date.now() - started) / 1000).toFixed(1)} s)`,
          );
        } else {
          const r = await ledger.check();
          differences += r.differences.length;
          const k = r.checked;
          console.log(
            `${c.slug}: ${r.differences.length} difference(s) — checked ${k.orders} orders, ${k.factoryParts} factory parts, ${k.accounts} money accounts, ${k.staff} people to repay, ${k.credits} customer credits, ${k.groups} postings`,
          );
          for (const d of r.differences.slice(0, 30))
            console.log(`  ${d.kind} ${d.key} (${d.currency}): ledger ${d.ledger}, today's figures ${d.expected}`);
        }
      });
    }
    if (differences) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
