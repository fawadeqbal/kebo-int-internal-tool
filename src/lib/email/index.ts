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

class SmtpMailer implements Mailer {
  readonly enabled = true;
  async send(message: MailMessage) {
    const nodemailer = await import("nodemailer");
    const port = Number(process.env.SMTP_PORT ?? 587);
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    });
    await transport.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, ...message, to: [message.to].flat().join(", ") });
  }
}

export function getMailer(): Mailer {
  return process.env.SMTP_HOST ? new SmtpMailer() : new ConsoleMailer();
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
