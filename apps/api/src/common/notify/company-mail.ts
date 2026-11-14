import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Inject, Injectable } from "@nestjs/common";
import { can, MAIL_PROVIDER_LABEL, type MailProvider, type MailSettingsInput, type MailSettingsView } from "@kebo/shared";
import { DomainError, ForbiddenError } from "@kebo/utils";
import type { Prisma } from "@kebo/database";
import { ENV, type Env } from "../../config/env";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { openSecret, sealSecret } from "../auth/totp";
import type { SessionUser } from "../auth/session-user";
import { getMailer, renderEmail, resendMailer, smtpMailer, type Mailer } from "./mailer";

/** The settings row that holds a company's own outgoing email. Not one of the settings the app hands out (GET /settings). */
const KEY = "mail";

/** As stored: the secret (Gmail app password, SMTP password, Resend API key) sealed with the server's key. */
interface Stored {
  provider: MailProvider;
  fromName: string;
  fromEmail: string;
  host: string | null;
  port: number | null;
  username: string | null;
  secret: string;
}

const isStored = (v: unknown): v is Stored =>
  !!v && typeof v === "object" && ["gmail", "smtp", "resend"].includes((v as Stored).provider) && typeof (v as Stored).secret === "string" && typeof (v as Stored).fromEmail === "string";

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
 * A company's own outgoing email (Admin settings › Email sending): its Gmail account, any SMTP server, or
 * Resend. Everything the company's work sends (quotations, reminders, the two-step note) goes through it;
 * a company that has not set one sends through the server's own, when the server has one.
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

  private async stored(): Promise<Stored | null> {
    const row = await this.prisma.db.setting.findFirst({ where: { key: KEY } });
    return row && isStored(row.value) ? row.value : null;
  }

  private mailerOf(s: Stored): Mailer {
    const from = fromHeader(s.fromName, s.fromEmail);
    const secret = openSecret(s.secret, this.env.AUTH_SECRET);
    if (s.provider === "resend") return resendMailer({ apiKey: secret, from });
    if (s.provider === "gmail") return smtpMailer({ host: "smtp.gmail.com", port: 465, user: s.username || s.fromEmail, password: secret, from });
    return smtpMailer({ host: s.host!, port: s.port ?? 587, user: s.username || null, password: secret, from });
  }

  /** The mailer for the company of this request: its own, else the server's (which may be off). */
  async mailer(): Promise<Mailer> {
    try {
      const s = await this.stored();
      if (s) return this.mailerOf(s);
    } catch {
      // A setting that cannot be read (the server's key changed) falls back to the server's own email.
    }
    return getMailer();
  }

  async view(user: SessionUser): Promise<MailSettingsView> {
    this.assertCan(user);
    const s = await this.stored();
    const serverDefault = getMailer().enabled;
    return {
      provider: s?.provider ?? null,
      fromName: s?.fromName ?? "",
      fromEmail: s?.fromEmail ?? "",
      host: s?.host ?? "",
      port: s?.port ?? null,
      username: s?.username ?? "",
      hasSecret: !!s,
      serverDefault,
      enabled: !!s || serverDefault,
    };
  }

  /** A company's mail server is somewhere on the internet: never this machine or its network. */
  private async checkHost(host: string) {
    if (process.env.NODE_ENV === "test" && host.endsWith(".test")) return;
    const found = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
    if (!found.length) throw new DomainError(`The mail server "${host}" was not found. Check its name.`);
    if (found.some((a) => isPrivateAddress(a.address))) throw new DomainError(`"${host}" is not a mail server on the internet.`);
  }

  async save(user: SessionUser, input: MailSettingsInput): Promise<MailSettingsView> {
    this.assertCan(user);
    const before = await this.stored();
    const typed = input.secret?.replace(input.provider === "gmail" ? /\s+/g : /^\s+|\s+$/g, "") ?? "";
    // The stored secret is kept only for the same account: another provider, server or user needs its own.
    const same =
      !!before &&
      before.provider === input.provider &&
      (input.provider === "resend" || ((before.host ?? "") === (input.host ?? "") && (before.username ?? "") === (input.username ?? "") && (input.provider !== "gmail" || before.fromEmail === input.fromEmail)));
    if (!typed && !same) throw new DomainError(`Type the ${input.provider === "resend" ? "API key" : input.provider === "gmail" ? "app password" : "password"}.`);
    if (input.provider === "smtp") await this.checkHost(input.host!);
    const value: Stored = {
      provider: input.provider,
      fromName: input.fromName,
      fromEmail: input.fromEmail,
      host: input.provider === "smtp" ? input.host! : null,
      port: input.provider === "smtp" ? input.port! : null,
      username: input.provider === "resend" ? null : input.username?.trim() || null,
      secret: typed ? sealSecret(typed, this.env.AUTH_SECRET) : before!.secret,
    };
    await this.prisma.tx(async (tx) => {
      await tx.setting.upsert({
        where: { companyId_key: { companyId: user.companyId, key: KEY } },
        create: { key: KEY, value: value as unknown as Prisma.InputJsonValue },
        update: { value: value as unknown as Prisma.InputJsonValue },
      });
      // The log says what changed, never the secret.
      await this.audit.record(tx, {
        userId: user.id,
        action: "update",
        entityType: "settings",
        summary: `Email sending: ${MAIL_PROVIDER_LABEL[input.provider]}, from ${input.fromEmail}${typed ? (before ? " (new password or key)" : "") : ""}`,
      });
    });
    return this.view(user);
  }

  /** Back to the server's own email. */
  async remove(user: SessionUser): Promise<MailSettingsView> {
    this.assertCan(user);
    await this.prisma.tx(async (tx) => {
      const gone = await tx.setting.deleteMany({ where: { key: KEY } });
      if (gone.count) await this.audit.record(tx, { userId: user.id, action: "delete", entityType: "settings", summary: "Email sending: the company's own setting removed" });
    });
    return this.view(user);
  }

  /** Sends one email the way it is set now, so the admin sees it arrive (or why it did not). */
  async test(user: SessionUser, to: string): Promise<{ ok: true; via: string }> {
    this.assertCan(user);
    const s = await this.stored();
    const mailer = await this.mailer();
    if (!mailer.enabled) throw new DomainError("Email is not set up yet: choose how to send it and save first.");
    if (s?.provider === "smtp") await this.checkHost(s.host!);
    const via = s ? MAIL_PROVIDER_LABEL[s.provider] : "the server's own email";
    const { html, text } = renderEmail({ heading: "Email works", body: `This is a test from Kebo ERP, sent through ${via}.`, footer: "Sent from Admin settings › Email sending." });
    try {
      await mailer.send({ to, subject: "Test email from Kebo ERP", html, text });
    } catch (e) {
      throw new DomainError(`The test was not sent: ${String((e as Error).message ?? e).replace(/\s+/g, " ").slice(0, 300)}`);
    }
    return { ok: true, via };
  }
}
