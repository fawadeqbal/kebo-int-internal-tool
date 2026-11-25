import { createHash } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import {
  can,
  glossaryOf,
  termsFor,
  textKey,
  wantsChinese,
  type TranslationListQuery,
  type TranslationView,
  type TranslatorStatus,
} from "@kebo/shared";
import type { Prisma } from "@kebo/database";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { CompanyContext } from "../../common/company/company-context";
import { ForbiddenError, NotFoundError } from "@kebo/utils";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { Translator } from "./translator";

/** A text's key in the memory: sha256 of the text as kept. */
export const hashOf = (text: string) => createHash("sha256").update(textKey(text)).digest("hex");

/** Tried again after a failure: 5 minutes, then 10, 15… at most 5 times. */
const MAX_TRIES = 5;
const AGAIN_MS = 5 * 60_000;

/**
 * A person's Chinese for a text (an item's name typed on the order): kept in the memory, where it wins over the
 * translator's from now on (the same item on the next order gets it).
 */
export async function rememberZh(tx: Tx, source: string, zh: string, userId: string) {
  const key = textKey(source);
  if (!key || !zh.trim()) return;
  const data = { zh: zh.trim(), by: "staff", status: "done", error: null, nextTryAt: null, checkedById: userId };
  await tx.translation.upsert({
    where: { companyId_hash: { companyId: CompanyContext.require().id, hash: hashOf(key) } },
    create: { hash: hashOf(key), source: key, ...data },
    update: data,
  });
}

/**
 * The translator's memory (25 Nov 2026): each English text the papers print, once, with its Chinese. Papers ask
 * for their texts (lookup: what is known now, the rest asked for); the worker translates what waits, one text at
 * a time, and gives the order's items their Chinese names (the memory's, else the translator's). People check and
 * correct on Settings › Chinese on papers; a person's Chinese always wins.
 */
@Injectable()
export class TranslationsService {
  private readonly log = new Logger("Translations");

  constructor(
    private readonly prisma: PrismaService,
    private readonly translator: Translator,
    private readonly settings: SettingsService,
  ) {}

  /** The Chinese of a paper's texts that have one (by the text as kept: textKey), and how many are still being written. */
  async lookup(texts: string[]) {
    const keys = [...new Set(texts.map(textKey))].filter(wantsChinese).slice(0, 300);
    if (!keys.length) return { found: {} as Record<string, string>, waiting: 0 };
    const byHash = new Map(keys.map((k) => [hashOf(k), k]));
    const rows = await this.prisma.db.translation.findMany({
      where: { hash: { in: [...byHash.keys()] } },
      select: { hash: true, zh: true, status: true, tries: true },
    });
    const found: Record<string, string> = {};
    for (const r of rows) if (r.zh) found[byHash.get(r.hash)!] = r.zh;
    const known = new Set(rows.map((r) => r.hash));
    const missing = [...byHash].filter(([h]) => !known.has(h));
    if (missing.length)
      await this.prisma.db.translation.createMany({ data: missing.map(([hash, source]) => ({ hash, source })), skipDuplicates: true });
    const waiting = rows.filter((r) => !r.zh && (r.status === "waiting" || r.tries < MAX_TRIES)).length + missing.length;
    return { found, waiting: this.translator.url ? waiting : 0 };
  }

  /** The companies with texts to translate now (waiting, or a failure due again): the worker's short beat goes to these only. */
  async dueCompanyIds(): Promise<string[]> {
    const rows = await this.prisma.platform.$queryRaw<{ company_id: string }[]>`
      select distinct t.company_id from translations t join companies c on c.id = t.company_id
      where c.status = 'active'
        and (t.status = 'waiting' or (t.status = 'failed' and t.tries < ${MAX_TRIES} and t.next_try_at <= now()))`;
    return rows.map((r) => r.company_id);
  }

  /**
   * The worker's turn, in the current company: what waits is translated (at most `limit` texts, oldest first),
   * and the order's items get those. Answers how many texts were translated. Stops at the first time the
   * translator cannot answer. (Items without a Chinese name are looked at on the slower beat: nameItems.)
   */
  async work(limit = 10): Promise<number> {
    const db = this.prisma.db;
    if ((await this.translator.state()) !== "ready") return 0;
    // What waits (and failures due again), oldest first.
    const due = await db.translation.findMany({
      where: {
        OR: [{ status: "waiting" }, { status: "failed", tries: { lt: MAX_TRIES }, nextTryAt: { lte: new Date() } }],
      },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    if (!due.length) return 0;
    const company = glossaryOf((await this.settings.get()).translation.glossary);
    let done = 0;
    for (const row of due) {
      let zh: string | null;
      try {
        zh = await this.translator.toChinese(row.source, termsFor(row.source, company));
      } catch (e) {
        // The translator went away: this text keeps its tries; the next turn carries on.
        this.log.warn(`translating stopped: ${(e as Error).message}`);
        break;
      }
      const tries = row.tries + 1;
      // Not changed while it was being translated (a person may have typed the Chinese meanwhile).
      const n = await db.translation.updateMany({
        where: { id: row.id, zh: null },
        data: zh
          ? { zh, by: "machine", status: "done", tries, error: null, nextTryAt: null }
          : { status: "failed", tries, error: "The answer was not Chinese.", nextTryAt: new Date(Date.now() + AGAIN_MS * tries) },
      });
      if (zh && n.count) done += 1;
    }
    if (done) await this.nameItems();
    return done;
  }

  /**
   * The order's goods lines without a Chinese name (orders not cancelled): the memory's Chinese, else asked for.
   * All of them, 500 at a time (some never get one: a code for a name, or a text the translator could not do).
   * The worker's follow-up beat (every few minutes), and after texts were translated.
   */
  async nameItems() {
    let after: string | undefined;
    for (;;) {
      const lines = await this.prisma.db.orderLine.findMany({
        where: { type: "goods", descriptionZh: null, order: { status: { not: "cancelled" } }, ...(after ? { id: { gt: after } } : {}) },
        select: { id: true, description: true },
        orderBy: { id: "asc" },
        take: 500,
      });
      if (!lines.length) return;
      await this.nameSome(lines);
      if (lines.length < 500) return;
      after = lines.at(-1)!.id;
    }
  }

  private async nameSome(lines: { id: string; description: string }[]) {
    const db = this.prisma.db;
    const wanted = lines.filter((l) => wantsChinese(l.description));
    if (!wanted.length) return;
    const hashes = new Map(wanted.map((l) => [l.id, hashOf(l.description)]));
    const rows = await db.translation.findMany({ where: { hash: { in: [...new Set(hashes.values())] } }, select: { hash: true, zh: true, by: true } });
    const byHash = new Map(rows.map((r) => [r.hash, r]));
    const ask: Prisma.TranslationCreateManyInput[] = [];
    for (const l of wanted) {
      const h = hashes.get(l.id)!;
      const r = byHash.get(h);
      if (r?.zh) await db.orderLine.updateMany({ where: { id: l.id, descriptionZh: null }, data: { descriptionZh: r.zh, zhBy: r.by === "staff" ? "staff" : "machine" } });
      else if (!r) {
        ask.push({ hash: h, source: textKey(l.description) });
        byHash.set(h, { hash: h, zh: null, by: null });
      }
    }
    if (ask.length) await db.translation.createMany({ data: ask, skipDuplicates: true });
  }

  private mayManage(user: SessionUser) {
    if (!can(user, "documents.manage")) throw new ForbiddenError("You cannot make documents.");
  }

  /** The translator now and its texts (Settings › Chinese on papers). */
  async status(user: SessionUser): Promise<TranslatorStatus> {
    this.mayManage(user);
    const db = this.prisma.db;
    const [state, check, waiting, failed, done] = await Promise.all([
      this.translator.state(),
      db.translation.count({ where: { by: "machine" } }),
      db.translation.count({ where: { status: "waiting" } }),
      db.translation.count({ where: { status: "failed" } }),
      db.translation.count({ where: { status: "done" } }),
    ]);
    return { state, counts: { check, waiting, failed, done } };
  }

  async list(user: SessionUser, q: TranslationListQuery) {
    this.mayManage(user);
    const where: Prisma.TranslationWhereInput = {
      ...(q.show === "check" ? { by: "machine" } : q.show === "waiting" ? { status: "waiting" } : q.show === "failed" ? { status: "failed" } : {}),
      ...(q.q ? { OR: [{ source: { contains: q.q, mode: "insensitive" } }, { zh: { contains: q.q } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.db.translation.count({ where }),
      this.prisma.db.translation.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    const people = await this.prisma.db.user.findMany({
      where: { id: { in: rows.map((r) => r.checkedById).filter((x): x is string => !!x) } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(people.map((p) => [p.id, p.name]));
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      rows: rows.map(
        (r): TranslationView => ({
          id: r.id,
          source: r.source,
          zh: r.zh,
          by: (r.by as TranslationView["by"]) ?? null,
          status: r.status as TranslationView["status"],
          error: r.error,
          tries: r.tries,
          checkedBy: r.checkedById ? (nameOf.get(r.checkedById) ?? null) : null,
          updatedAt: r.updatedAt.toISOString(),
        }),
      ),
    };
  }

  private async row(id: string) {
    const r = await this.prisma.db.translation.findUnique({ where: { id } });
    if (!r) throw new NotFoundError("Translation");
    return r;
  }

  /**
   * A person's Chinese for a text: kept as theirs (it wins over the translator's); the order items that print
   * the translator's Chinese for the same text get it too.
   */
  async fix(user: SessionUser, id: string, zh: string) {
    this.mayManage(user);
    const r = await this.row(id);
    await this.prisma.tx(async (tx) => {
      await tx.translation.update({ where: { id }, data: { zh, by: "staff", status: "done", error: null, nextTryAt: null, checkedById: user.id } });
      await this.relabel(tx, r.source, r.zh, zh);
    });
    return this.one(id);
  }

  /** The translator's Chinese is right: now a person's (checked). */
  async check(user: SessionUser, id: string) {
    this.mayManage(user);
    const r = await this.row(id);
    if (!r.zh) throw new NotFoundError("Translation");
    await this.prisma.tx(async (tx) => {
      await tx.translation.update({ where: { id }, data: { by: "staff", checkedById: user.id } });
      await this.relabel(tx, r.source, r.zh, r.zh!);
    });
    return this.one(id);
  }

  /** Translate it again (the translator's, or one that failed): it waits for the worker. */
  async again(user: SessionUser, id: string) {
    this.mayManage(user);
    const r = await this.row(id);
    if (r.by === "staff") throw new ForbiddenError("A person wrote this Chinese: change it instead.");
    await this.prisma.db.translation.update({ where: { id }, data: { zh: null, by: null, status: "waiting", tries: 0, error: null, nextTryAt: null } });
    return this.one(id);
  }

  /** The items whose Chinese came from this text by the translator: now the person's. */
  private async relabel(tx: Tx, source: string, was: string | null, now: string) {
    if (!was) return;
    const lines = await tx.orderLine.findMany({ where: { descriptionZh: was, zhBy: "machine" }, select: { id: true, description: true } });
    const ids = lines.filter((l) => textKey(l.description) === source).map((l) => l.id);
    if (ids.length) await tx.orderLine.updateMany({ where: { id: { in: ids } }, data: { descriptionZh: now, zhBy: "staff" } });
  }

  private async one(id: string): Promise<TranslationView> {
    const r = await this.row(id);
    const who = r.checkedById ? await this.prisma.db.user.findUnique({ where: { id: r.checkedById }, select: { name: true } }) : null;
    return {
      id: r.id,
      source: r.source,
      zh: r.zh,
      by: (r.by as TranslationView["by"]) ?? null,
      status: r.status as TranslationView["status"],
      error: r.error,
      tries: r.tries,
      checkedBy: who?.name ?? null,
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}

