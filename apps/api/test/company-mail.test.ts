import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CompanyMail, fromHeader, isPrivateAddress } from "../src/common/notify/company-mail";
import { resendMailer } from "../src/common/notify/mailer";
import { api, signIn, startApp } from "./app";

/**
 * Admin settings › Email sending: each company sets how its own email goes out (Gmail, an SMTP server or
 * Resend). Admins only; the password or key goes in sealed and never comes back; a company without its own
 * setting sends through the server's.
 */
describe("a company's own outgoing email", () => {
  let app: INestApplication;
  let admin: string;
  let manager: string;
  const KEY = "re_test_key_never_sent_back_123";
  const resend = { provider: "resend", fromName: "Kebo Sales", fromEmail: "Sales@Kebo.Test", secret: KEY };

  beforeAll(async () => {
    app = await startApp();
    admin = await signIn(app, "admin@example.com", "Admin@12345");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    await api(app, admin).delete("/mail-settings");
  });

  afterAll(async () => {
    // Nothing is left behind: the other tests send (or do not send) through the server's own.
    await api(app, admin).delete("/mail-settings");
    await app?.close();
  });

  it("is the admin's: a manager, who runs the company's other settings, cannot open or change it", async () => {
    await api(app, manager).get("/mail-settings").expect(403);
    await api(app, manager).put("/mail-settings", resend).expect(403);
    await api(app, manager).post("/mail-settings/test", { to: "a@b.test" }).expect(403);
    await api(app, manager).delete("/mail-settings").expect(403);
    await api(app, "").get("/mail-settings").expect(401);
  });

  it("starts not set, and says whether the server has its own email", async () => {
    const v = (await api(app, admin).get("/mail-settings").expect(200)).body;
    expect(v).toMatchObject({ provider: null, fromEmail: "", hasSecret: false });
    expect(v.enabled).toBe(v.serverDefault);
    if (!v.serverDefault) expect((await api(app, admin).post("/mail-settings/test", { to: "a@b.test" }).expect(400)).body.error).toMatch(/not set up yet/);
  });

  it("asks for what each way needs", async () => {
    await api(app, admin).put("/mail-settings", { provider: "pigeon", fromEmail: "a@b.test", secret: "x" }).expect(422);
    await api(app, admin).put("/mail-settings", { ...resend, fromEmail: "not an address" }).expect(422);
    // The password or key, the first time.
    expect((await api(app, admin).put("/mail-settings", { provider: "resend", fromEmail: "a@b.test" }).expect(400)).body.error).toMatch(/API key/);
    expect((await api(app, admin).put("/mail-settings", { provider: "gmail", fromEmail: "a@gmail.com" }).expect(400)).body.error).toMatch(/app password/);
    // An SMTP server: its name and one of the mail ports.
    await api(app, admin).put("/mail-settings", { provider: "smtp", fromEmail: "a@b.test", secret: "x" }).expect(422);
    await api(app, admin).put("/mail-settings", { provider: "smtp", fromEmail: "a@b.test", host: "smtp.b.test", port: 5432, secret: "x" }).expect(422);
    // Never this machine or its network.
    for (const host of ["127.0.0.1", "localhost", "10.0.0.5", "169.254.169.254"])
      expect((await api(app, admin).put("/mail-settings", { provider: "smtp", fromEmail: "a@b.test", host, port: 587, secret: "x" }).expect(400)).body.error).toMatch(/not a mail server on the internet|was not found/);
    expect((await api(app, admin).get("/mail-settings").expect(200)).body.provider).toBeNull();
  });

  it("saves it, and never gives the key back", async () => {
    const saved = await api(app, admin).put("/mail-settings", resend).expect(200);
    expect(saved.body).toMatchObject({ provider: "resend", fromName: "Kebo Sales", fromEmail: "sales@kebo.test", hasSecret: true, enabled: true });
    expect(JSON.stringify(saved.body)).not.toContain(KEY);
    const again = await api(app, admin).get("/mail-settings").expect(200);
    expect(JSON.stringify(again.body)).not.toContain(KEY);
    expect(again.body).not.toHaveProperty("secret");
    // Not one of the settings the app hands out to everyone signed in.
    const all = await api(app, manager).get("/settings").expect(200);
    expect(all.body).not.toHaveProperty("mail");
    expect(JSON.stringify(all.body)).not.toContain(KEY);
    // The log says what changed, not the key.
    const log = (await api(app, admin).get("/audit?entityType=settings").expect(200)).body;
    const summaries = (log.rows ?? log).map((r: { summary: string }) => r.summary).join("\n");
    expect(summaries).toContain("Email sending: Resend, from sales@kebo.test");
    expect(JSON.stringify(log)).not.toContain(KEY);
  });

  it("keeps the stored key when none is typed, but not for another account", async () => {
    const v = (await api(app, admin).put("/mail-settings", { provider: "resend", fromName: "Kebo", fromEmail: "hello@kebo.test" }).expect(200)).body;
    expect(v).toMatchObject({ provider: "resend", fromName: "Kebo", fromEmail: "hello@kebo.test", hasSecret: true });
    expect((await api(app, admin).put("/mail-settings", { provider: "gmail", fromEmail: "kebo@gmail.com" }).expect(400)).body.error).toMatch(/app password/);
    expect((await api(app, admin).get("/mail-settings").expect(200)).body.provider).toBe("resend");
  });

  it("goes back to the server's own when it is removed", async () => {
    const v = (await api(app, admin).delete("/mail-settings").expect(200)).body;
    expect(v).toMatchObject({ provider: null, hasSecret: false });
    expect(v.enabled).toBe(v.serverDefault);
  });
});

describe("the pieces of sending", () => {
  it("writes the From header safely", () => {
    expect(fromHeader("Kebo International", "sales@kebo.test")).toBe('"Kebo International" <sales@kebo.test>');
    expect(fromHeader("", "sales@kebo.test")).toBe("sales@kebo.test");
    expect(fromHeader('Evil" <x@y.test>\r\nBcc: z@y.test', "sales@kebo.test")).toBe('"Evil x@y.test Bcc: z@y.test" <sales@kebo.test>');
  });

  it("knows an address inside the network from one on the internet", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "142.250.80.109", "2607:f8b0:4004:c07::6c"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("sends through Resend's API with the company's key, and says why when Resend refuses", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = (async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response(JSON.stringify({ id: "1" }), { status: 200 }))) as unknown as typeof fetch;
    await resendMailer({ apiKey: "re_abc", from: '"Kebo" <sales@kebo.test>' }, ok).send({
      to: ["buyer@gulf.test"],
      cc: "boss@gulf.test",
      subject: "Quotation",
      text: "Attached.",
      replyTo: "sana@kebo.test",
      attachments: [{ filename: "q.pdf", content: Buffer.from("pdf"), contentType: "application/pdf" }],
    });
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer re_abc");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      from: '"Kebo" <sales@kebo.test>',
      to: ["buyer@gulf.test"],
      subject: "Quotation",
      text: "Attached.",
      cc: ["boss@gulf.test"],
      reply_to: "sana@kebo.test",
      attachments: [{ filename: "q.pdf", content: Buffer.from("pdf").toString("base64"), content_type: "application/pdf" }],
    });
    const refused = (async () => new Response(JSON.stringify({ message: "The kebo.test domain is not verified." }), { status: 403 })) as unknown as typeof fetch;
    await expect(resendMailer({ apiKey: "re_abc", from: "a@kebo.test" }, refused).send({ to: "b@c.test", subject: "s", text: "t" })).rejects.toThrow("Resend answered 403: The kebo.test domain is not verified.");
  });

  it("uses the company's own mailer once it is set, and the server's before", async () => {
    const rows = new Map<string, unknown>();
    const db = {
      setting: {
        findFirst: async () => (rows.has("mail") ? { key: "mail", value: rows.get("mail") } : null),
        upsert: async (a: { create: { value: unknown }; update: { value: unknown } }) => void rows.set("mail", rows.has("mail") ? a.update.value : a.create.value),
        deleteMany: async () => ({ count: rows.delete("mail") ? 1 : 0 }),
      },
    };
    const mail = new CompanyMail({ db, tx: async (fn: (tx: unknown) => unknown) => fn(db) } as never, { record: async () => undefined } as never, { AUTH_SECRET: "s".repeat(40) } as never);
    const adminUser = { id: "u", companyId: "c", permissions: ["security.manage"] } as never;
    expect((await mail.mailer()).enabled).toBe(!!process.env.SMTP_HOST);
    await mail.save(adminUser, { provider: "gmail", fromName: "Kebo", fromEmail: "kebo@gmail.com", secret: "abcd efgh ijkl mnop" });
    // Sealed, not as typed (and the spaces of an app password are dropped).
    const stored = rows.get("mail") as { secret: string };
    expect(stored.secret).toMatch(/^v1\./);
    expect(JSON.stringify(stored)).not.toContain("abcd");
    expect((await mail.mailer()).enabled).toBe(true);
    await mail.remove(adminUser);
    expect((await mail.mailer()).enabled).toBe(!!process.env.SMTP_HOST);
    // Someone who is not an admin is refused before anything is read.
    await expect(mail.view({ id: "u", companyId: "c", permissions: ["settings.manage"] } as never)).rejects.toThrow(/Only an admin/);
  });
});
