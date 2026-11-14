/**
 * Mailer interface. The app depends on this interface only, so the SMTP
 * implementation can be replaced (e.g. by an API-based provider) without
 * changing business code.
 */
export interface MailMessage {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  cc?: string | string[];
  /** Files sent with it (a quotation's PDF). */
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

export interface Mailer {
  readonly enabled: boolean;
  send(message: MailMessage): Promise<void>;
}

class ConsoleMailer implements Mailer {
  readonly enabled = false;
  async send(message: MailMessage) {
    if (process.env.NODE_ENV !== "test") console.info(`[mail disabled — set SMTP_HOST] to=${[message.to].flat().join(",")} subject="${message.subject}"`);
  }
}

export interface SmtpOptions {
  host: string;
  port: number;
  user?: string | null;
  password?: string | null;
  /** "Name <address>" or the address alone. */
  from: string;
}

/** Sends through an SMTP server (the server's own, a company's, or Gmail's with an app password). */
export function smtpMailer(o: SmtpOptions): Mailer {
  return {
    enabled: true,
    async send(message) {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.createTransport({
        host: o.host,
        port: o.port,
        secure: o.port === 465,
        auth: o.user ? { user: o.user, pass: o.password ?? "" } : undefined,
        // A wrong host or port answers in seconds, not minutes.
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
      await transport.sendMail({
        from: o.from,
        ...message,
        to: [message.to].flat().join(", "),
        cc: message.cc ? [message.cc].flat().join(", ") : undefined,
      });
    },
  };
}

/** Sends through Resend's API (POST /emails with the company's key). `post` is replaceable in tests. */
export function resendMailer(o: { apiKey: string; from: string }, post: typeof fetch = fetch): Mailer {
  return {
    enabled: true,
    async send(message) {
      const res = await post("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${o.apiKey}`, "content-type": "application/json" },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          from: o.from,
          to: [message.to].flat(),
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
          ...(message.cc ? { cc: [message.cc].flat() } : {}),
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
          ...(message.attachments?.length
            ? { attachments: message.attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64"), ...(a.contentType ? { content_type: a.contentType } : {}) })) }
            : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(`Resend answered ${res.status}${body?.message ? `: ${body.message}` : ""}`);
      }
    },
  };
}

/** The server's own mail (SMTP_HOST…): what a company without its own email setting sends through. */
export function getMailer(): Mailer {
  if (!process.env.SMTP_HOST) return new ConsoleMailer();
  return smtpMailer({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: process.env.SMTP_FROM || process.env.SMTP_USER || "",
  });
}

/** Escape text for use inside an HTML email. */
export const esc = (s: string | null | undefined) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A plain, readable HTML email: title, key/value rows, optional body text and a button. */
export function renderEmail(opts: { heading: string; rows?: [string, string | null | undefined][]; body?: string | null; link?: string; linkLabel?: string; footer?: string }) {
  const rows = (opts.rows ?? []).filter(([, v]) => v);
  const html = `<!doctype html><html><body style="margin:0;background:#f5f6f4;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1b1f1e">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #e3e5e1;border-radius:12px">
<tr><td style="padding:20px 24px;border-bottom:1px solid #e3e5e1"><div style="font-size:17px;font-weight:600">${esc(opts.heading)}</div></td></tr>
<tr><td style="padding:16px 24px">
${rows.length ? `<table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#5f6763;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`).join("")}</table>` : ""}
${opts.body ? `<div style="margin-top:12px;padding:12px;background:#f5f6f4;border-radius:8px;font-size:14px;white-space:pre-wrap">${esc(opts.body)}</div>` : ""}
${opts.link ? `<div style="margin-top:20px"><a href="${esc(opts.link)}" style="display:inline-block;background:#0e7666;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:600">${esc(opts.linkLabel ?? "Open")}</a></div>` : ""}
</td></tr></table>
<div style="font-size:12px;color:#8a908c;margin-top:12px">${esc(opts.footer ?? "")}</div>
</td></tr></table></body></html>`;
  const text = [
    opts.heading,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(opts.body ? ["", opts.body] : []),
    ...(opts.link ? ["", `${opts.linkLabel ?? "Open"}: ${opts.link}`] : []),
  ].join("\n");
  return { html, text };
}
