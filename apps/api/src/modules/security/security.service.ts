import { Injectable } from "@nestjs/common";
import {
  can,
  deviceOf,
  PERMISSION_GROUPS,
  PRESET_ROLE_KEYS,
  permissionsOfRole,
  roleKeyOf,
  type Permission,
  type RoleInput,
} from "@kebo/shared";
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from "@kebo/utils";
import type { Prisma } from "@kebo/database";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { SESSION_MAX_AGE_DAYS } from "../../common/auth/tokens.service";
import type { SessionUser } from "../../common/auth/session-user";

const LABEL = new Map(PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => [i.permission, i.label] as const)));
const labels = (ps: readonly string[]) => ps.map((p) => LABEL.get(p as Permission) ?? p).join(", ");

const FAILED = ["wrong_password", "unknown_email", "wrong_code", "locked", "switched_off", "too_many"] as const;

/** Sessions that still work: not signed out, not expired, not past the longest a session may last. */
const live = (): Prisma.SessionWhereInput => ({
  revokedAt: null,
  expiresAt: { gt: new Date() },
  createdAt: { gt: new Date(Date.now() - SESSION_MAX_AGE_DAYS * 86_400_000) },
});

const sessionSelect = {
  id: true,
  createdAt: true,
  lastSeenAt: true,
  expiresAt: true,
  ip: true,
  userAgent: true,
  pendingTwoStep: true,
  user: { select: { id: true, name: true, email: true } },
} as const;

/**
 * Security (Super Admin): roles and what each may do, two-step sign-in per
 * role, everyone's signed-in devices and the sign-in history. Also each
 * person's own devices and sign-ins under My account.
 */
@Injectable()
export class SecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* ---------------------------------------------------------------- roles */

  /** For Security (all details) and for People (the role picker). */
  async roles(actor: SessionUser) {
    if (!can(actor, "security.manage") && !can(actor, "users.manage")) throw new ForbiddenError();
    const [roles, mine, counts] = await Promise.all([
      this.prisma.db.role.findMany({ orderBy: [{ superAdmin: "desc" }, { createdAt: "asc" }, { name: "asc" }] }),
      this.prisma.db.role.findUnique({ where: { key: actor.role } }),
      this.prisma.db.user.groupBy({ by: ["role"], where: { isSystem: false, isActive: true }, _count: true }),
    ]);
    const without = await this.prisma.db.user.groupBy({
      by: ["role"],
      where: { isSystem: false, isActive: true, totpEnabledAt: null },
      _count: true,
    });
    return roles.map((r) => {
      const permissions = permissionsOfRole(r);
      // People may give a role only when it allows nothing more than their own.
      const givable = !!mine?.superAdmin || (!r.superAdmin && permissions.every((p) => actor.permissions.includes(p)));
      return {
        key: r.key,
        name: r.name,
        description: r.description,
        permissions,
        superAdmin: r.superAdmin,
        preset: (PRESET_ROLE_KEYS as readonly string[]).includes(r.key),
        requireTwoStep: r.requireTwoStep,
        people: counts.find((c) => c.role === r.key)?._count ?? 0,
        withoutTwoStep: without.find((c) => c.role === r.key)?._count ?? 0,
        givable,
      };
    });
  }

  async role(actor: SessionUser, key: string) {
    const roles = await this.roles(actor);
    const r = roles.find((x) => x.key === key);
    if (!r) throw new NotFoundError("Role");
    const people = await this.prisma.db.user.findMany({
      where: { role: key, isSystem: false },
      select: { id: true, name: true, email: true, isActive: true, totpEnabledAt: true, lastLoginAt: true },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });
    return { ...r, members: people };
  }

  /** Only what the actor may do themselves can go into a role they make or change (a Super Admin may give anything). */
  private async checkWithin(actor: SessionUser, permissions: readonly Permission[]) {
    const mine = await this.prisma.db.role.findUnique({ where: { key: actor.role } });
    if (mine?.superAdmin) return;
    const more = permissions.filter((p) => !actor.permissions.includes(p));
    if (more.length) throw new ForbiddenError(`You can only give what your own role allows. Not yours: ${labels(more)}.`);
  }

  async createRole(actor: SessionUser, input: RoleInput) {
    const permissions = [...new Set(input.permissions)];
    await this.checkWithin(actor, permissions);
    if (await this.prisma.db.role.findFirst({ where: { name: { equals: input.name, mode: "insensitive" } } }))
      throw new ConflictError("There is already a role with this name.");
    const base = roleKeyOf(input.name);
    let key = base;
    for (let n = 2; await this.prisma.db.role.findUnique({ where: { key } }); n++) key = `${base}-${n}`;
    return this.prisma.tx(async (tx) => {
      const r = await tx.role.create({
        data: { key, name: input.name, description: input.description, permissions, requireTwoStep: input.requireTwoStep },
      });
      await this.audit.record(tx, {
        userId: actor.id,
        action: "create",
        entityType: "role",
        summary: `Made the role ${r.name}${r.requireTwoStep ? " (two-step sign-in required)" : ""}`,
        newValues: { key, name: r.name, permissions, requireTwoStep: r.requireTwoStep },
      });
      return { key: r.key };
    });
  }

  async updateRole(actor: SessionUser, key: string, input: RoleInput) {
    const role = await this.prisma.db.role.findUnique({ where: { key } });
    if (!role) throw new NotFoundError("Role");
    const before = permissionsOfRole(role);
    // The Super Admin keeps its name and every permission; only its description and two-step rule change.
    const permissions = role.superAdmin ? [] : [...new Set(input.permissions)];
    const name = role.superAdmin ? role.name : input.name;
    if (!role.superAdmin) {
      // Only roles within one's own may be changed, and only towards what one has.
      await this.checkWithin(actor, before);
      await this.checkWithin(actor, permissions);
      if (key === actor.role && !permissions.includes("security.manage")) {
        throw new DomainError("This is your own role: keep Security in it, or you would lock yourself out of this page.");
      }
    } else if ((await this.prisma.db.role.findUnique({ where: { key: actor.role } }))?.superAdmin !== true) {
      throw new ForbiddenError("Only a Super Admin can change the Super Admin role.");
    }
    if (
      name !== role.name &&
      (await this.prisma.db.role.findFirst({ where: { name: { equals: name, mode: "insensitive" }, key: { not: key } } }))
    ) {
      throw new ConflictError("There is already a role with this name.");
    }
    const after = role.superAdmin ? before : permissionsOfRole({ superAdmin: false, permissions });
    const added = after.filter((p) => !before.includes(p));
    const removed = before.filter((p) => !after.includes(p));
    return this.prisma.tx(async (tx) => {
      await tx.role.update({
        where: { key },
        data: { name, description: input.description, permissions, requireTwoStep: input.requireTwoStep },
      });
      const changes = [
        name !== role.name ? `renamed from ${role.name}` : null,
        added.length ? `added ${labels(added)}` : null,
        removed.length ? `removed ${labels(removed)}` : null,
        input.requireTwoStep !== role.requireTwoStep
          ? input.requireTwoStep
            ? "two-step sign-in now required"
            : "two-step sign-in no longer required"
          : null,
      ].filter(Boolean);
      await this.audit.record(tx, {
        userId: actor.id,
        action: "update",
        entityType: "role",
        summary: `Changed the role ${name}${changes.length ? `: ${changes.join("; ")}` : ""}`,
        oldValues: { key, name: role.name, permissions: before, requireTwoStep: role.requireTwoStep },
        newValues: { key, name, permissions: after, requireTwoStep: input.requireTwoStep },
      });
      return { key };
    });
  }

  async deleteRole(actor: SessionUser, key: string) {
    if (!can(actor, "security.manage")) throw new ForbiddenError();
    const role = await this.prisma.db.role.findUnique({ where: { key } });
    if (!role) throw new NotFoundError("Role");
    if ((PRESET_ROLE_KEYS as readonly string[]).includes(key))
      throw new DomainError(`${role.name} is one of the built-in roles. Change it instead.`);
    await this.checkWithin(actor, permissionsOfRole(role));
    const people = await this.prisma.db.user.count({ where: { role: key } });
    if (people)
      throw new ConflictError(
        `${people} ${people === 1 ? "person has" : "people have"} this role (switched-off people count too). Give them another role first.`,
      );
    await this.prisma.tx(async (tx) => {
      await tx.role.delete({ where: { key } });
      await this.audit.record(tx, {
        userId: actor.id,
        action: "delete",
        entityType: "role",
        summary: `Removed the role ${role.name}`,
        oldValues: { key, name: role.name, permissions: permissionsOfRole(role) },
      });
    });
  }

  /* ---------------------------------------------------------------- overview */

  async overview() {
    const day = new Date(Date.now() - 86_400_000);
    const [sessions, people, failed, blockedIps, missing] = await Promise.all([
      this.prisma.db.session.count({ where: { ...live(), pendingTwoStep: false, user: { isActive: true } } }),
      this.prisma.db.user.count({ where: { isSystem: false, isActive: true } }),
      this.prisma.db.signIn.count({ where: { at: { gte: day }, result: { in: [...FAILED] } } }),
      this.prisma.db.signIn.findMany({ where: { at: { gte: day }, result: "too_many" }, select: { ip: true }, distinct: ["ip"] }),
      this.prisma.db.user.findMany({
        where: { isSystem: false, isActive: true, totpEnabledAt: null, access: { requireTwoStep: true } },
        select: { id: true, name: true, access: { select: { name: true } } },
        orderBy: { name: "asc" },
      }),
    ]);
    const withTwoStep = await this.prisma.db.user.count({ where: { isSystem: false, isActive: true, totpEnabledAt: { not: null } } });
    return {
      liveSessions: sessions,
      people,
      withTwoStep,
      failedLastDay: failed,
      blockedIpsLastDay: blockedIps.length,
      /** People whose role needs two-step sign-in but who have not set it up: they must at their next request. */
      mustSetUp: missing.map((u) => ({ id: u.id, name: u.name, role: u.access.name })),
    };
  }

  /* ---------------------------------------------------------------- sessions */

  private sessionView(
    s: {
      id: string;
      createdAt: Date;
      lastSeenAt: Date;
      expiresAt: Date;
      ip: string | null;
      userAgent: string | null;
      pendingTwoStep: boolean;
      user: { id: string; name: string; email: string };
    },
    current: string,
  ) {
    return {
      id: s.id,
      user: s.user,
      device: deviceOf(s.userAgent),
      userAgent: s.userAgent,
      ip: s.ip,
      signedInAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      /** Password given, two-step code not yet. */
      waitingForCode: s.pendingTwoStep,
      current: s.id === current,
    };
  }

  async sessions(actor: SessionUser, userId?: string) {
    const rows = await this.prisma.db.session.findMany({
      where: { ...live(), user: { isActive: true, isSystem: false }, ...(userId ? { userId } : {}) },
      select: sessionSelect,
      orderBy: { lastSeenAt: "desc" },
      take: 500,
    });
    return rows.map((s) => this.sessionView(s, actor.sessionId));
  }

  async mySessions(actor: SessionUser) {
    const rows = await this.prisma.db.session.findMany({
      where: { ...live(), userId: actor.id, pendingTwoStep: false },
      select: sessionSelect,
      orderBy: { lastSeenAt: "desc" },
    });
    return rows.map((s) => this.sessionView(s, actor.sessionId));
  }

  /** Sign out one device: one's own, or anyone's with Security. */
  async endSession(actor: SessionUser, id: string, own: boolean) {
    const s = await this.prisma.db.session.findUnique({ where: { id }, include: { user: true } });
    if (!s || (own && s.userId !== actor.id)) throw new NotFoundError("Session");
    if (!own && !can(actor, "security.manage")) throw new ForbiddenError();
    if (s.revokedAt) return;
    const device = deviceOf(s.userAgent);
    await this.prisma.tx(async (tx) => {
      await tx.session.update({ where: { id }, data: { revokedAt: new Date() } });
      await this.audit.record(tx, {
        userId: actor.id,
        action: "sign_out",
        entityType: "user",
        entityId: s.userId,
        summary:
          s.userId === actor.id
            ? `Signed out own ${device}${s.ip ? ` (${s.ip})` : ""}`
            : `Signed ${s.user.name} out of ${device}${s.ip ? ` (${s.ip})` : ""}`,
      });
    });
  }

  /** Sign someone out everywhere (with Security), or oneself everywhere but here. Returns how many devices. */
  async endAll(actor: SessionUser, userId: string) {
    const self = userId === actor.id;
    if (!self && !can(actor, "security.manage")) throw new ForbiddenError();
    const user = await this.prisma.db.user.findFirst({ where: { id: userId, isSystem: false } });
    if (!user) throw new NotFoundError("User");
    return this.prisma.tx(async (tx) => {
      const r = await tx.session.updateMany({
        where: { userId, revokedAt: null, ...(self ? { id: { not: actor.sessionId } } : {}) },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(tx, {
        userId: actor.id,
        action: "sign_out",
        entityType: "user",
        entityId: userId,
        summary: self
          ? `Signed out own other devices (${r.count})`
          : `Signed ${user.name} out everywhere (${r.count} device${r.count === 1 ? "" : "s"})`,
      });
      return { ended: r.count };
    });
  }

  /* ---------------------------------------------------------------- sign-in history */

  async signIns(q: { userId?: string; failed?: boolean; page: number; pageSize: number; q?: string }) {
    const where: Prisma.SignInWhereInput = {
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.failed ? { result: { in: [...FAILED] } } : {}),
      ...(q.q ? { OR: [{ email: { contains: q.q, mode: "insensitive" } }, { ip: { startsWith: q.q } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.signIn.findMany({
        where,
        orderBy: { at: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { user: { select: { id: true, name: true } } },
      }),
      this.prisma.db.signIn.count({ where }),
    ]);
    return {
      rows: rows.map((r) => ({
        id: r.id,
        at: r.at,
        email: r.email,
        user: r.user,
        result: r.result,
        detail: r.detail,
        ip: r.ip,
        device: deviceOf(r.userAgent),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async mySignIns(actor: SessionUser) {
    return (await this.signIns({ userId: actor.id, page: 1, pageSize: 15 })).rows;
  }
}
