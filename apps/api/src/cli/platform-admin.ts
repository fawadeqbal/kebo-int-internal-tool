import "../load-env";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Module } from "@nestjs/common";
import { EnvModule } from "../config/env";
import { PrismaModule, PrismaService } from "../database/prisma.service";
import { AuthCoreModule } from "../common/auth/auth-core.module";
import { CompaniesModule } from "../common/company/companies.service";
import { PlatformAuthService } from "../platform/platform-auth";

/**
 * Platform admins, from the command line (the first one has to start somewhere):
 *
 *   node apps/api/dist/cli/platform-admin.js add <email> "<name>"   a new admin, and a link to set the password
 *   node apps/api/dist/cli/platform-admin.js link <email>           a new set-password link
 *   node apps/api/dist/cli/platform-admin.js off <email>            switch an admin off (their sessions end)
 *   node apps/api/dist/cli/platform-admin.js list
 *
 * In Docker: docker compose exec api node apps/api/dist/cli/platform-admin.js add …
 */
@Module({ imports: [EnvModule, PrismaModule, CompaniesModule, AuthCoreModule], providers: [PlatformAuthService] })
class CliModule {}

async function main() {
  const [cmd, emailArg, ...rest] = process.argv.slice(2);
  const app = await NestFactory.createApplicationContext(CliModule, { logger: ["error"] });
  const prisma = app.get(PrismaService);
  const auth = app.get(PlatformAuthService);
  const email = emailArg?.trim().toLowerCase();
  try {
    if (cmd === "add" && email) {
      const name = rest.join(" ").trim() || email.split("@")[0];
      const admin = await prisma.platform.platformAdmin.upsert({ where: { email }, update: { isActive: true }, create: { email, name, passwordHash: "!" } });
      console.log(`Platform admin ${admin.name} <${admin.email}>. Set the password (link works once, for 2 days):\n${await auth.passwordLink(admin.id)}`);
    } else if (cmd === "link" && email) {
      const admin = await prisma.platform.platformAdmin.findUniqueOrThrow({ where: { email } });
      console.log(await auth.passwordLink(admin.id));
    } else if (cmd === "off" && email) {
      const admin = await prisma.platform.platformAdmin.update({ where: { email }, data: { isActive: false } });
      await prisma.platform.platformSession.updateMany({ where: { adminId: admin.id, revokedAt: null }, data: { revokedAt: new Date() } });
      console.log(`${admin.email} is switched off.`);
    } else if (cmd === "list") {
      for (const a of await prisma.platform.platformAdmin.findMany({ orderBy: { createdAt: "asc" } })) {
        console.log(`${a.isActive ? "on " : "off"}  ${a.email}  ${a.name}  two-step: ${a.totpEnabledAt ? "on" : "not set up"}`);
      }
    } else {
      console.log('Usage: platform-admin add <email> "<name>" | link <email> | off <email> | list');
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
