import { Inject, Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { DomainError, NotFoundError } from "@kebo/utils";
import { ENV, type Env } from "../config/env";
import { PrismaService } from "../database/prisma.service";
import { TokensService } from "../common/auth/tokens.service";
import { AuditService } from "../common/audit/audit.service";
import { CompaniesService } from "../common/company/companies.service";
import { CompanyContext } from "../common/company/company-context";
import { SESSION_TTL_SECONDS } from "../common/auth/tokens.service";
import { fingerprint, type PlatformAdminUser } from "./platform-auth";

/** How long a platform admin's visit to a company lasts before signing in again. */
const VISIT_HOURS = 8;

/**
 * People's accounts inside companies, as the platform reaches them: the link
 * that sets a password (a new tenant admin, a reset), and the platform admin's
 * own hidden account in a company they open.
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
    private readonly companies: CompaniesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** A link (valid 7 days, once) for this person to set their password. */
  async setPasswordLink(companyId: string, userId: string) {
    const u = await this.prisma.company(companyId).user.findUniqueOrThrow({ where: { id: userId } });
    const token = await this.tokens.signPurpose("set_password", { uid: u.id, cid: companyId, pw: fingerprint(u.passwordHash) }, "7d");
    return `${this.env.APP_URL.replace(/\/$/, "")}/set-password?token=${encodeURIComponent(token)}`;
  }

  /** What a set-password link is for (the page shows it before the password is chosen). */
  async linkInfo(token: string) {
    const found = await this.fromLink(token);
    return { email: found.user.email, name: found.user.name, company: found.company.name };
  }

  private async fromLink(token: string) {
    const claims = await this.tokens.verifyPurpose("set_password", token);
    const company = claims && (await this.companies.byId(String(claims.cid)));
    const user = company && (await this.prisma.company(company.id).user.findUnique({ where: { id: String(claims.uid) } }));
    if (!claims || !company || !user || user.isSystem || user.platformAdminId || claims.pw !== fingerprint(user.passwordHash)) {
      throw new DomainError("This link has expired or was already used. Ask your admin for a new one.");
    }
    return { company, user };
  }

  async setPassword(token: string, password: string) {
    const { company, user } = await this.fromLink(token);
    await CompanyContext.run(company, () =>
      this.prisma.tx(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash: await bcrypt.hash(password, 12), failedLogins: 0, lockedUntil: null, isActive: true },
        });
        await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
        await this.audit.record(tx, {
          userId: user.id,
          action: "password_set",
          entityType: "user",
          entityId: user.id,
          summary: `${user.email} set a password with a link`,
        });
      }),
    );
    return { email: user.email, company: company.slug };
  }

  /** The company's tenant admins (people in its Super Admin role). */
  async tenantAdmins(companyId: string) {
    return this.prisma.company(companyId).user.findMany({
      where: { isSystem: false, platformAdminId: null, access: { superAdmin: true } },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * The platform admin opens a company: they work in it through their own
   * hidden account there (in its Super Admin role), so everything they do is
   * in the company's history under their name. Returns a session token.
   */
  async open(admin: PlatformAdminUser, companyId: string, meta: { ip: string; userAgent?: string }) {
    const company = await this.companies.byId(companyId);
    if (!company) throw new NotFoundError("Company");
    return CompanyContext.run(company, async () => {
      const db = this.prisma.db;
      const role = await db.role.findFirst({ where: { superAdmin: true }, orderBy: { createdAt: "asc" } });
      if (!role) throw new DomainError("This company has no Super Admin role.");
      const email = `platform-${admin.id.slice(0, 8)}@platform.invalid`;
      const name = `${admin.name} (platform admin)`;
      let user = await db.user.findFirst({ where: { platformAdminId: admin.id } });
      if (!user) user = await db.user.create({ data: { email, name, role: role.key, passwordHash: "!", platformAdminId: admin.id } });
      else if (user.name !== name || user.role !== role.key || !user.isActive)
        user = await db.user.update({ where: { id: user.id }, data: { name, role: role.key, isActive: true } });
      const session = await this.prisma.tx(async (tx) => {
        const s = await tx.session.create({
          data: {
            userId: user.id,
            expiresAt: new Date(Date.now() + Math.min(VISIT_HOURS * 3600, SESSION_TTL_SECONDS) * 1000),
            ip: meta.ip.slice(0, 64),
            userAgent: meta.userAgent?.slice(0, 300),
          },
        });
        await this.audit.record(tx, {
          userId: user.id,
          action: "platform_open",
          entityType: "company",
          summary: `${admin.name} (platform admin) opened the company`,
        });
        return s;
      });
      await this.prisma.platform.platformLog.create({
        data: { adminId: admin.id, adminName: admin.name, action: "open", companyId, summary: `Opened ${company.name}` },
      });
      return { token: await this.tokens.sign(user.id, session.id, companyId), expiresInSeconds: VISIT_HOURS * 3600, slug: company.slug };
    });
  }
}
