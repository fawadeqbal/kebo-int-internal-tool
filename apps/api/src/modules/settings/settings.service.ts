import { Injectable } from "@nestjs/common";
import { readSettings, SETTINGS, type Settings, type SettingsKey } from "@kebo/shared";
import type { Prisma } from "@kebo/database";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import type { SessionUser } from "../../common/auth/session-user";

const CACHE_MS = 30_000;

/** Typed settings with defaults filled in; read often, so cached briefly per process. */
@Injectable()
export class SettingsService {
  private cache: { at: number; value: Settings } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<Settings> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const rows = await this.prisma.db.setting.findMany();
    const value = readSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])));
    this.cache = { at: Date.now(), value };
    return value;
  }

  async update<K extends SettingsKey>(user: SessionUser, key: K, input: unknown): Promise<Settings[K]> {
    const value = SETTINGS[key].parse(input) as Settings[K];
    const before = (await this.get())[key];
    await this.prisma.tx(async (tx) => {
      await tx.setting.upsert({ where: { key }, create: { key, value: value as Prisma.InputJsonValue }, update: { value: value as Prisma.InputJsonValue } });
      await this.audit.record(tx, { userId: user.id, action: "update", entityType: "settings", summary: `Changed ${key} settings`, oldValues: before as never, newValues: value as never });
    });
    this.cache = null;
    return value;
  }
}
