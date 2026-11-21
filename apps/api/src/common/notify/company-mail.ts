import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Inject, Injectable } from "@nestjs/common";
import { can, MAIL_ACCOUNTS_MAX, MAIL_PROVIDER_LABEL, MAIL_USES, type MailAccountInput, type MailProvider, type MailSenders, type MailSettingsView, type MailUse, type MailUsesInput } from "@kebo/shared";
import { DomainError, ForbiddenError, NotFoundError } from "@kebo/utils";
import type { Prisma } from "@kebo/database";
import { ENV, type Env } from "../../config/env";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { openSecret, sealSecret } from "../auth/totp";
import type { SessionUser } from "../auth/session-user";
import { getMailer, renderEmail, resendMailer, smtpMailer, type Mailer } from "./mailer";

/** The settings row that holds a company's own email accounts. Not one of the settings the app hands out (GET /settings). */
const KEY = "mail";

/** One account as stored: the secret (Gmail app password, SMTP password, Resend API key) sealed with the server's key. */
interface Stored {
  id: string;
  provider: MailProvider;
  fromName: string;
  fromEmail: string;
  host: string | null;
  port: number | null;
  username: string | null;
  secret: string;
}

/** The row: the accounts, which one each use goes from, the default, and whether people may choose. */
interface Book {
  v: 2;
  accounts: Stored[];
  defaultId: string | null;
  uses: Partial<Record<MailUse, string | null>>;
  choose: boolean;
}

const isAccount = (v: unknown): v is Omit<Stored, "id"> & { id?: string } =>
  !!v && typeof v === "object" && ["gmail", "smtp", "resend"].includes((v as Stored).provider) && typeof (v as Stored).secret === "string" && typeof (v as Stored).fromEmail === "string";

/** The row as it is now, or as it was (one account, before 21 Nov 2026), read the same way. */
export function readBook(value: unknown): Book {
  const empty: Book = { v: 2, accounts: [], defaultId: null, uses: {}, choose: true };
  if (!value || typeof value !== "object") return empty;
  if ((value as Book).v === 2) {
    const b = value as Book;
    const accounts = (Array.isArray(b.accounts) ? b.accounts : []).filter(isAccount).filter((a) => typeof a.id === "string");
    const has = (id: string | null | undefined) => (id && accounts.some((a) => a.id === id) ? id : null);
    return { v: 2, accounts, defaultId: has(b.defaultId) ?? accounts[0]?.id ?? null, uses: Object.fromEntries(MAIL_USES.map((u) => [u, has(b.uses?.[u])])), choose: b.choose !== false };
  }
  if (isAccount(value)) return { ...empty, accounts: [{ ...value, id: "a1" }], defaultId: "a1" };
  return empty;
}

/** "Kebo International <sales@kebo.example>": the name without anything that could break the header. */
export function fromHeader(name: string, email: string): string {
  const clean = name.replace(/[\r\n"<>]/g, " ").replace(/\s+/g, " ").trim();
  return clean ? `"${clean}" <${email}>` : email;
}

/** An address on this machine or inside its network: never dialled for a company's mail server. */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(v) === 4) {
    const [a, b] = v.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb");
}

/**
 * A company's own email accounts (Admin settings › Email accounts): any number of Gmail accounts, SMTP
 * servers or Resend keys. Each kind of email goes from the account chosen for it (else the default), and a
 * send window may pick another when the admin allows it; a company with none sends through the server's own.
 */
@Injectable()
export class CompanyMail {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private assertCan(user: SessionUser) {
    if (!can(user, "security.manage")) throw new ForbiddenError("Only an admin sets how the company's email is sent.");
  }

  private async book(): Promise<Book> {
    const row = await this.prisma.db.setting.findFirst({ where: { key: KEY } });
    return readBook(row?.value);
  }

  private async write(user: SessionUser, book: Book, summary: string) {
    await this.prisma.tx(async (tx) => {
      const value = book as unknown as Prisma.InputJsonValue;
      await tx.setting.upsert({ where: { companyId_key: { companyId: user.companyId, key: KEY } }, create: { key: KEY, value }, update: { value } });
      // The log says what changed, never the secret.
      await this.audit.record(tx, { userId: user.id, action: "update", entityType: "settings", summary });
    });
  }

  private mailerOf(s: Stored): Mailer {
    const from = fromHeader(s.fromName, s.fromEmail);
    const secret = openSecret(s.secret, this.env.AUTH_SECRET);
    if (s.provider === "resend") return resendMailer({ apiKey: secret, from });
    if (s.provider === "gmail") return smtpMailer({ host: "smtp.gmail.com", port: 465, user: s.username || s.fromEmail, password: secret, from });
    return smtpMailer({ host: s.host!, port: s.port ?? 587, user: s.username || null, password: secret, from });
  }

  /** The account a use goes from: the one chosen when sending (if people may choose), else the use's, else the default. */
  private pick(b: Book, use: MailUse, chosen?: string | null): Stored | undefined {
    const find = (id: string | null | undefined) => (id ? b.accounts.find((a) => a.id === id) : undefined);
    return (b.choose ? find(chosen) : undefined) ?? find(b.uses[use]) ?? find(b.defaultId) ?? b.accounts[0];
  }

  /**
   * The mailer for the company of this request and what the email is for: its own account for that use (or
   * the one chosen when sending), else the server's (which may be off).
   */
  async mailer(use: MailUse = "staff", chosen?: string | null): Promise<Mailer> {
    try {
      const s = this.pick(await this.book(), use, chosen);
      if (s) return this.mailerOf(s);
    } catch {
      // A setting that cannot be read (the server's key changed) falls back to the server's own email.
    }
    return getMailer();
  }

  /** For a send window (anyone who may send): the addresses it may go from and the one it starts on. */
  async senders(use: MailUse): Promise<MailSenders> {
    const b = await this.book();
    const label = (a: Stored) => (a.fromName ? `${a.fromName} · ${a.fromEmail}` : a.fromEmail);
    const start = this.pick(b, use);
    return { from: b.accounts.map((a) => ({ id: a.id, label: label(a) })), chosen: start?.id ?? null, choose: b.choose && b.accounts.length > 1 };
  }

  async view(user: SessionUser): Promise<MailSettingsView> {
    this.assertCan(user);
    const b = await this.book();
    const serverDefault = getMailer().enabled;
    return {
      accounts: b.accounts.map((s) => ({ id: s.id, provider: s.provider, fromName: s.fromName, fromEmail: s.fromEmail, host: s.host ?? "", port: s.port, username: s.username ?? "", hasSecret: true })),
      defaultId: b.defaultId,
      uses: b.uses,
      choose: b.choose,
      serverDefault,
      enabled: b.accounts.length > 0 || serverDefault,
    };
  }

  /** A company's mail server is somewhere on the internet: never this machine or its network. */
  private async checkHost(host: string) {
    if (process.env.NODE_ENV === "test" && host.endsWith(".test")) return;
    const found = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
    if (!found.length) throw new DomainError(`The mail server "${host}" was not found. Check its name.`);
    if (found.some((a) => isPrivateAddress(a.address))) throw new DomainError(`"${host}" is not a mail server on the internet.`);
  }

  /** The account as it will be stored: the typed secret sealed, or the stored one kept for the same account. */
  private async account(id: string, input: MailAccountInput, before?: Stored): Promise<Stored> {
    const typed = input.secret?.replace(input.provider === "gmail" ? /\s+/g : /^\s+|\s+$/g, "") ?? "";
    // The stored secret is kept only for the same account: another provider, server or user needs its own.
    const same =
      !!before &&
      before.provider === input.provider &&
      (input.provider === "resend" || ((before.host ?? "") === (input.host ?? "") && (before.username ?? "") === (input.username ?? "") && (input.provider !== "gmail" || before.fromEmail === input.fromEmail)));
    if (!typed && !same) throw new DomainError(`Type the ${input.provider === "resend" ? "API key" : input.provider === "gmail" ? "app password" : "password"}.`);
    if (input.provider === "smtp") await this.checkHost(input.host!);
    return {
      id,
      provider: input.provider,
      fromName: input.fromName,
      fromEmail: input.fromEmail,
      host: input.provider === "smtp" ? input.host! : null,
      port: input.provider === "smtp" ? input.port! : null,
      username: input.provider === "resend" ? null : input.username?.trim() || null,
      secret: typed ? sealSecret(typed, this.env.AUTH_SECRET) : before!.secret,
    };
  }

  /** Connect one more address. The first becomes the default. */
  async add(user: SessionUser, input: MailAccountInput): Promise<MailSettingsView> {
    this.assertCan(user);
    const b = await this.book();
    if (b.accounts.length >= MAIL_ACCOUNTS_MAX) throw new DomainError(`At most ${MAIL_ACCOUNTS_MAX} email accounts.`);
    if (b.accounts.some((a) => a.fromEmail === input.fromEmail)) throw new DomainError(`${input.fromEmail} is connected already: change that one instead.`);
    const id = randomUUID().slice(0, 8);
    const s = await this.account(id, input);
    const next: Book = { ...b, accounts: [...b.accounts, s], defaultId: b.defaultId ?? id };
    await this.write(user, next, `Email accounts: ${input.fromEmail} connected (${MAIL_PROVIDER_LABEL[input.provider]})`);
    return this.view(user);
  }

  /** Change one: a password or key left empty keeps the stored one (for the same account). */
  async update(user: SessionUser, id: string, input: MailAccountInput): Promise<MailSettingsView> {
    this.assertCan(user);
    const b = await this.book();
    const before = b.accounts.find((a) => a.id === id);
    if (!before) throw new NotFoundError("Email account");
    if (b.accounts.some((a) => a.id !== id && a.fromEmail === input.fromEmail)) throw new DomainError(`${input.fromEmail} is connected already.`);
    const s = await this.account(id, input, before);
    const next: Book = { ...b, accounts: b.accounts.map((a) => (a.id === id ? s : a)) };
    await this.write(user, next, `Email accounts: ${input.fromEmail} changed (${MAIL_PROVIDER_LABEL[input.provider]}${input.secret ? ", new password or key" : ""})`);
    return this.view(user);
  }

  /** Disconnect one: what it sent goes from the default (another account, if it was the default). */
  async disconnect(user: SessionUser, id: string): Promise<MailSettingsView> {
    this.assertCan(user);
    const b = await this.book();
    const gone = b.accounts.find((a) => a.id === id);
    if (!gone) throw new NotFoundError("Email account");
    const accounts = b.accounts.filter((a) => a.id !== id);
    const next: Book = {
      ...b,
      accounts,
      defaultId: b.defaultId === id ? (accounts[0]?.id ?? null) : b.defaultId,
      uses: Object.fromEntries(Object.entries(b.uses).map(([k, v]) => [k, v === id ? null : v])),
    };
    await this.write(user, next, `Email accounts: ${gone.fromEmail} disconnected`);
    return this.view(user);
  }

  /** Which address each use goes from, the default, and whether people may choose when sending. */
  async setUses(user: SessionUser, input: MailUsesInput): Promise<MailSettingsView> {
    this.assertCan(user);
    const b = await this.book();
    const known = (id: string | null | undefined) => {
      if (!id) return null;
      if (!b.accounts.some((a) => a.id === id)) throw new DomainError("That email account is not connected any more. Reload the page.");
      return id;
    };
    const next: Book = {
      ...b,
      defaultId: known(input.defaultId) ?? b.accounts[0]?.id ?? null,
      uses: Object.fromEntries(MAIL_USES.map((u) => [u, known(input.uses[u])])),
      choose: input.choose,
    };
    const name = (id: string | null) => b.accounts.find((a) => a.id === id)?.fromEmail ?? "the default";
    await this.write(user, next, `Email accounts: default ${name(next.defaultId)}; ${MAIL_USES.map((u) => `${u} from ${name(next.uses[u] ?? null)}`).join(", ")}; choosing when sending ${next.choose ? "on" : "off"}`);
    return this.view(user);
  }

  /** Back to the server's own email: every account disconnected. */
  async remove(user: SessionUser): Promise<MailSettingsView> {
    this.assertCan(user);
    await this.prisma.tx(async (tx) => {
      const gone = await tx.setting.deleteMany({ where: { key: KEY } });
      if (gone.count) await this.audit.record(tx, { userId: user.id, action: "delete", entityType: "settings", summary: "Email accounts: all disconnected" });
    });
    return this.view(user);
  }

  /** Sends one email through an account (else the default), so the admin sees it arrive (or why it did not). */
  async test(user: SessionUser, to: string, accountId?: string | null): Promise<{ ok: true; via: string }> {
    this.assertCan(user);
    const b = await this.book();
    const s = (accountId && b.accounts.find((a) => a.id === accountId)) || this.pick(b, "staff");
    if (accountId && s?.id !== accountId) throw new NotFoundError("Email account");
    const mailer = s ? this.mailerOf(s) : getMailer();
    if (!mailer.enabled) throw new DomainError("Email is not set up yet: connect an email account first.");
    if (s?.provider === "smtp") await this.checkHost(s.host!);
    const via = s ? `${s.fromEmail} (${MAIL_PROVIDER_LABEL[s.provider]})` : "the server's own email";
    const { html, text } = renderEmail({ heading: "Email works", body: `This is a test from RFQ Desk, sent from ${via}.`, footer: "Sent from Admin settings › Email accounts." });
    try {
      await mailer.send({ to, subject: "Test email from RFQ Desk", html, text });
    } catch (e) {
      throw new DomainError(`The test was not sent: ${String((e as Error).message ?? e).replace(/\s+/g, " ").slice(0, 300)}`);
    }
    return { ok: true, via };
  }
}
