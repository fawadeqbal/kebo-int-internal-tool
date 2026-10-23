/**
 * Mailer interface. The app depends on this interface only, so the SMTP
 * implementation can be replaced (e.g. by an API-based provider) without
 * changing business code.
 */
export interface Mailer {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

class ConsoleMailer implements Mailer {
  async send(message: { to: string; subject: string; text: string }) {
    if (process.env.NODE_ENV !== "test") console.info(`[mail disabled] to=${message.to} subject="${message.subject}"`);
  }
}

class SmtpMailer implements Mailer {
  async send(message: { to: string; subject: string; text: string }) {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    });
    await transport.sendMail({ from: process.env.SMTP_FROM, ...message });
  }
}

export function getMailer(): Mailer {
  return process.env.SMTP_HOST ? new SmtpMailer() : new ConsoleMailer();
}
