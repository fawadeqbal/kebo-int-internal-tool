import { Injectable, Logger } from "@nestjs/common";
import type { Response } from "express";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { Prisma } from "@kebo/database";
import { PrismaService } from "../database/prisma.service";
import { StorageService } from "../common/storage/storage.service";

/** Every column that holds the storage key of a company file. */
const FILE_COLUMNS = [
  { table: "attachments", key: "storage_key", name: "file_name" },
  { table: "payments", key: "file_key", name: "file_name" },
  { table: "factory_payments", key: "file_key", name: "file_name" },
  { table: "expenses", key: "receipt_key", name: "receipt_name" },
] as const;

/** Sample people a demo is filled with (removed when a demo becomes real without its data). */
export const SAMPLE_EMAILS = ["bilal@example.com", "sana@example.com"];

/** Tables kept when a demo becomes a real company without its sample data. */
const KEPT_WHEN_CLEARED = new Set(["roles", "users", "settings", "sessions", "sign_ins", "device_tokens"]);

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

/**
 * A whole company's data at once, for the platform admin: export it, clear it,
 * delete it. Works through the owner's connection with an explicit company id
 * (the only place that does), on the company tables only (the ones under
 * row-level security).
 */
@Injectable()
export class CompanyDataService {
  private readonly log = new Logger("CompanyData");
  private order: Promise<string[]> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** The company tables, children before the tables they point to (safe order to delete in). */
  tables(): Promise<string[]> {
    this.order ??= (async () => {
      const db = this.prisma.platform;
      const tables = (
        await db.$queryRaw<{ t: string }[]>`select c.relname as t from pg_class c where c.relrowsecurity and c.relkind = 'r' and c.relnamespace = current_schema()::regnamespace order by 1`
      ).map((r) => r.t);
      const edges = await db.$queryRaw<{ child: string; parent: string }[]>`
        select cl.relname as child, pa.relname as parent from pg_constraint k
          join pg_class cl on cl.oid = k.conrelid join pg_class pa on pa.oid = k.confrelid
         where k.contype = 'f' and cl.relrowsecurity and pa.relrowsecurity and cl.oid <> pa.oid`;
      // Kahn's sort: a table can go once every table pointing at it has gone.
      const pointing = new Map(tables.map((t) => [t, new Set<string>()]));
      for (const e of edges) pointing.get(e.parent)?.add(e.child);
      const out: string[] = [];
      const left = new Set(tables);
      while (left.size) {
        const ready = [...left].filter((t) => [...pointing.get(t)!].every((c) => !left.has(c)));
        if (!ready.length) throw new Error(`Company tables point at each other in a circle: ${[...left].join(", ")}`);
        for (const t of ready.sort()) {
          out.push(t);
          left.delete(t);
        }
      }
      return out;
    })().catch((e) => {
      this.order = null;
      throw e;
    });
    return this.order;
  }

  /** Storage keys of every file of the company. */
  private async fileKeys(companyId: string) {
    const out: { key: string; name: string }[] = [];
    for (const f of FILE_COLUMNS) {
      const rows = await this.prisma.platform.$queryRawUnsafe<{ key: string; name: string | null }[]>(
        `select ${q(f.key)} as key, ${q(f.name)} as name from ${q(f.table)} where company_id = $1::uuid and ${q(f.key)} is not null`,
        companyId,
      );
      for (const r of rows) out.push({ key: r.key, name: r.name ?? "file" });
    }
    return out;
  }

  /**
   * Remove the company's data. everything: all of it (the company is being
   * deleted); otherwise the sample data only (a demo becoming real), keeping its
   * people, roles and settings.
   */
  async clear(companyId: string, everything: boolean) {
    const files = await this.fileKeys(companyId);
    const order = await this.tables();
    await this.prisma.platform.$transaction(
      async (tx) => {
        for (const t of order) {
          if (!everything && KEPT_WHEN_CLEARED.has(t)) continue;
          if (!everything && t === "users") continue;
          await tx.$executeRawUnsafe(`delete from ${q(t)} where company_id = $1::uuid`, companyId);
        }
        if (!everything) {
          await tx.$executeRaw`delete from users where company_id = ${companyId}::uuid and email in (${Prisma.join(SAMPLE_EMAILS)})`;
          await tx.$executeRaw`delete from counters where company_id = ${companyId}::uuid`;
        }
      },
      { timeout: 10 * 60_000, maxWait: 30_000 },
    );
    let failed = 0;
    for (const f of files) await this.storage.delete(f.key).catch(() => failed++);
    if (failed) this.log.warn(`${failed} of ${files.length} files of company ${companyId} could not be removed from storage`);
    await this.prisma.forget(companyId);
    return { files: files.length };
  }

  /** A zip of the company: every table as JSON (data/<table>.json) and every file (files/…). */
  async export(companyId: string, slug: string, res: Response) {
    const order = await this.tables();
    const files = await this.fileKeys(companyId);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${slug}-export-${new Date().toISOString().slice(0, 10)}.zip"`);
    const done = new Promise<void>((resolve, reject) => {
      const zip = new Zip((err, chunk, final) => {
        if (err) return reject(err);
        res.write(Buffer.from(chunk));
        if (final) {
          res.end();
          resolve();
        }
      });
      (async () => {
        const enc = new TextEncoder();
        const readme = new ZipDeflate("README.txt", { level: 6 });
        zip.add(readme);
        readme.push(
          enc.encode(
            `Export of company "${slug}" made ${new Date().toISOString()}.\n\ndata/<table>.json: every row of each table, as JSON.\nfiles/: the uploaded files, in folders by their storage key.\n`,
          ),
          true,
        );
        for (const t of [...order].reverse()) {
          const rows = await this.prisma.platform.$queryRawUnsafe<Record<string, unknown>[]>(`select * from ${q(t)} where company_id = $1::uuid`, companyId);
          // Never hand out sign-in secrets.
          if (t === "users") for (const r of rows) for (const k of ["password_hash", "totp_secret", "recovery_codes", "totp_last_step"]) delete r[k];
          const entry = new ZipDeflate(`data/${t}.json`, { level: 6 });
          zip.add(entry);
          entry.push(enc.encode(JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 1)), true);
        }
        for (const f of files) {
          const entry = new ZipPassThrough(`files/${f.key.replace(/^companies\/[^/]+\//, "")}`);
          zip.add(entry);
          try {
            const stream = await this.storage.get(f.key);
            for await (const chunk of stream) entry.push(chunk as Uint8Array);
          } catch {
            this.log.warn(`export ${slug}: file ${f.key} is missing`);
          }
          entry.push(new Uint8Array(0), true);
        }
        zip.end();
      })().catch(reject);
    });
    await done;
  }

  /** Every company's usage at once (the platform admin's list). */
  async usageAll() {
    const db = this.prisma.platform;
    const [users, inquiries, storage] = await Promise.all([
      db.$queryRaw<{ company_id: string; n: bigint }[]>`select company_id, count(*) as n from users where not is_system and platform_admin_id is null and is_active group by 1`,
      db.$queryRaw<{ company_id: string; n: bigint }[]>`select company_id, count(*) as n from inquiries where deleted_at is null group by 1`,
      db.$queryRaw<{ company_id: string; bytes: bigint }[]>`
        select company_id, sum(b)::bigint as bytes from (
          select company_id, size::bigint as b from attachments
          union all select company_id, file_size::bigint from payments where file_size is not null
          union all select company_id, file_size::bigint from factory_payments where file_size is not null
          union all select company_id, receipt_size::bigint from expenses where receipt_size is not null) f group by 1`,
    ]);
    const out = new Map<string, { users: number; inquiries: number; storageMb: number }>();
    const of = (id: string) => out.get(id) ?? (out.set(id, { users: 0, inquiries: 0, storageMb: 0 }), out.get(id)!);
    for (const r of users) of(r.company_id).users = Number(r.n);
    for (const r of inquiries) of(r.company_id).inquiries = Number(r.n);
    for (const r of storage) of(r.company_id).storageMb = Math.round((Number(r.bytes) / 1024 / 1024) * 10) / 10;
    return out;
  }

  /** What happened in a company lately (the platform admin's view of a demo or client). */
  async activity(companyId: string) {
    const db = this.prisma.platform;
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [signIns, lastSignIn, created, orders, people] = await Promise.all([
      db.$queryRaw<{ n: bigint }[]>`select count(*) as n from sign_ins where company_id = ${companyId}::uuid and result = 'signed_in' and at >= ${since}`,
      db.$queryRaw<{ at: Date | null; email: string | null }[]>`select at, email from sign_ins where company_id = ${companyId}::uuid and result = 'signed_in' order by at desc limit 1`,
      db.$queryRaw<{ total: bigint; recent: bigint }[]>`select count(*) as total, count(*) filter (where created_at >= ${since}) as recent from inquiries where company_id = ${companyId}::uuid and deleted_at is null`,
      db.$queryRaw<{ n: bigint }[]>`select count(*) as n from orders where company_id = ${companyId}::uuid and status <> 'cancelled'`,
      db.$queryRaw<{ id: string; name: string; email: string; is_active: boolean; last_login_at: Date | null; role: string; super_admin: boolean }[]>`
        select u.id, u.name, u.email, u.is_active, u.last_login_at, r.name as role, r.super_admin
          from users u join roles r on r.company_id = u.company_id and r.key = u.role
         where u.company_id = ${companyId}::uuid and not u.is_system and u.platform_admin_id is null
         order by r.super_admin desc, u.name`,
    ]);
    return {
      signInsLast30Days: Number(signIns[0]?.n ?? 0),
      lastSignIn: lastSignIn[0] ?? null,
      inquiries: Number(created[0]?.total ?? 0),
      inquiriesLast30Days: Number(created[0]?.recent ?? 0),
      orders: Number(orders[0]?.n ?? 0),
      people: people.map((p) => ({ id: p.id, name: p.name, email: p.email, active: p.is_active, lastLoginAt: p.last_login_at, role: p.role, tenantAdmin: p.super_admin })),
    };
  }
}
