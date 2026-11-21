import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CompanyMail, fromHeader, isPrivateAddress, readBook } from "../src/common/notify/company-mail";
import { resendMailer } from "../src/common/notify/mailer";
import { api, signIn, startApp } from "./app";

/**
 * Admin settings › Email accounts: each company connects the addresses its email goes out from (Gmail, an SMTP
 * server or Resend), and which one each kind of email uses. Admins only; the password or key goes in sealed and never comes back; a company without its own
 * setting sends through the server's.
 */
describe("a company's own email accounts", () => {
  let app: INestApplication;
  let admin: string;
  let manager: string;
  const KEY = "re_test_key_never_sent_back_123";
  const resend = { provider: "resend", fromName: "Kebo Sales", fromEmail: "Sales@Kebo.Test", secret: KEY };
  const gmail = { provider: "gmail", fromName: "Kebo Accounts", fromEmail: "accounts@kebo.test", secret: "abcd efgh ijkl mnop" };

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
    await api(app, manager).post("/mail-settings/accounts", resend).expect(403);
    await api(app, manager).put("/mail-settings/uses", { choose: true }).expect(403);
    await api(app, manager).post("/mail-settings/test", { to: "a@b.test" }).expect(403);
    await api(app, manager).delete("/mail-settings").expect(403);
    await api(app, "").get("/mail-settings").expect(401);
  });

  it("starts with none, and says whether the server has its own email", async () => {
    const v = (await api(app, admin).get("/mail-settings").expect(200)).body;
    expect(v).toMatchObject({ accounts: [], defaultId: null, choose: true });
    expect(v.enabled).toBe(v.serverDefault);
    if (!v.serverDefault) expect((await api(app, admin).post("/mail-settings/test", { to: "a@b.test" }).expect(400)).body.error).toMatch(/not set up yet/);
  });

  it("asks for what each way needs", async () => {
    await api(app, admin).post("/mail-settings/accounts", { provider: "pigeon", fromEmail: "a@b.test", secret: "x" }).expect(422);
    await api(app, admin).post("/mail-settings/accounts", { ...resend, fromEmail: "not an address" }).expect(422);
    // The password or key, the first time.
    expect((await api(app, admin).post("/mail-settings/accounts", { provider: "resend", fromEmail: "a@b.test" }).expect(400)).body.error).toMatch(/API key/);
    expect((await api(app, admin).post("/mail-settings/accounts", { provider: "gmail", fromEmail: "a@gmail.com" }).expect(400)).body.error).toMatch(/app password/);
    // An SMTP server: its name and one of the mail ports.
    await api(app, admin).post("/mail-settings/accounts", { provider: "smtp", fromEmail: "a@b.test", secret: "x" }).expect(422);
    await api(app, admin).post("/mail-settings/accounts", { provider: "smtp", fromEmail: "a@b.test", host: "smtp.b.test", port: 5432, secret: "x" }).expect(422);
    // Never this machine or its network.
    for (const host of ["127.0.0.1", "localhost", "10.0.0.5", "169.254.169.254"])
      expect((await api(app, admin).post("/mail-settings/accounts", { provider: "smtp", fromEmail: "a@b.test", host, port: 587, secret: "x" }).expect(400)).body.error).toMatch(/not a mail server on the internet|was not found/);
    expect((await api(app, admin).get("/mail-settings").expect(200)).body.accounts).toEqual([]);
  });

  it("connects several, the first is the default, and never gives a key back", async () => {
    const one = (await api(app, admin).post("/mail-settings/accounts", resend).expect(200)).body;
    expect(one.accounts).toHaveLength(1);
    expect(one.accounts[0]).toMatchObject({ provider: "resend", fromName: "Kebo Sales", fromEmail: "sales@kebo.test", hasSecret: true });
    expect(one.defaultId).toBe(one.accounts[0].id);
    expect(one.enabled).toBe(true);
    const two = (await api(app, admin).post("/mail-settings/accounts", gmail).expect(200)).body;
    expect(two.accounts.map((a: { fromEmail: string }) => a.fromEmail)).toEqual(["sales@kebo.test", "accounts@kebo.test"]);
    expect(two.defaultId).toBe(one.accounts[0].id);
    // The same address twice is refused.
    expect((await api(app, admin).post("/mail-settings/accounts", resend).expect(400)).body.error).toMatch(/connected already/);
    for (const body of [one, two, (await api(app, admin).get("/mail-settings").expect(200)).body]) {
      expect(JSON.stringify(body)).not.toContain(KEY);
      expect(JSON.stringify(body)).not.toContain("abcd");
    }
    // Not one of the settings the app hands out to everyone signed in.
    const all = await api(app, manager).get("/settings").expect(200);
    expect(all.body).not.toHaveProperty("mail");
    expect(JSON.stringify(all.body)).not.toContain(KEY);
    // The log says what changed, not the key.
    const log = (await api(app, admin).get("/audit?entityType=settings").expect(200)).body;
    const summaries = (log.rows ?? log).map((r: { summary: string }) => r.summary).join("\n");
    expect(summaries).toContain("Email accounts: sales@kebo.test connected (Resend)");
    expect(JSON.stringify(log)).not.toContain(KEY);
  });

  it("keeps the stored key when none is typed, but not for another account", async () => {
    const v = (await api(app, admin).get("/mail-settings").expect(200)).body;
    const sales = v.accounts.find((a: { fromEmail: string }) => a.fromEmail === "sales@kebo.test").id;
    const changed = (await api(app, admin).put(`/mail-settings/accounts/${sales}`, { provider: "resend", fromName: "Kebo", fromEmail: "sales@kebo.test" }).expect(200)).body;
    expect(changed.accounts[0]).toMatchObject({ fromName: "Kebo", hasSecret: true });
    expect((await api(app, admin).put(`/mail-settings/accounts/${sales}`, { provider: "gmail", fromEmail: "kebo@gmail.com" }).expect(400)).body.error).toMatch(/app password/);
    await api(app, admin).put("/mail-settings/accounts/nope", resend).expect(404);
  });

  it("sends each kind from the address chosen for it, and tells a send window what it may pick", async () => {
    const v = (await api(app, admin).get("/mail-settings").expect(200)).body;
    const [sales, accounts] = v.accounts.map((a: { id: string }) => a.id);
    const set = (await api(app, admin).put("/mail-settings/uses", { defaultId: accounts, uses: { customers: sales }, choose: true }).expect(200)).body;
    expect(set).toMatchObject({ defaultId: accounts, uses: { customers: sales, staff: null }, choose: true });
    await api(app, admin).put("/mail-settings/uses", { uses: { customers: "gone" } }).expect(400);
    // Anyone signed in sees the names (no secrets) and where the window starts.
    const s = (await api(app, manager).get("/mail-settings/senders?use=customers").expect(200)).body;
    expect(s).toEqual({ from: [{ id: sales, label: "Kebo · sales@kebo.test" }, { id: accounts, label: "Kebo Accounts · accounts@kebo.test" }], chosen: sales, choose: true });
    expect((await api(app, manager).get("/mail-settings/senders?use=staff").expect(200)).body.chosen).toBe(accounts);
    await api(app, manager).get("/mail-settings/senders?use=pigeons").expect(400);
    // Choosing switched off: the window shows no choice.
    await api(app, admin).put("/mail-settings/uses", { defaultId: accounts, uses: { customers: sales }, choose: false }).expect(200);
    expect((await api(app, manager).get("/mail-settings/senders?use=customers").expect(200)).body.choose).toBe(false);
  });

  it("disconnects one: what it sent goes from the default", async () => {
    const v = (await api(app, admin).get("/mail-settings").expect(200)).body;
    const sales = v.uses.customers;
    const after = (await api(app, admin).delete(`/mail-settings/accounts/${sales}`).expect(200)).body;
    expect(after.accounts).toHaveLength(1);
    expect(after.uses.customers).toBeNull();
    expect((await api(app, manager).get("/mail-settings/senders?use=customers").expect(200)).body.chosen).toBe(after.defaultId);
  });

  it("goes back to the server's own when all are removed", async () => {
    const v = (await api(app, admin).delete("/mail-settings").expect(200)).body;
    expect(v).toMatchObject({ accounts: [], defaultId: null });
    expect(v.enabled).toBe(v.serverDefault);
  });
});

describe("the pieces of sending", () => {
  it("reads the one account saved before 21 Nov 2026 as the default", () => {
    const old = { provider: "resend", fromName: "Kebo", fromEmail: "a@kebo.test", host: null, port: null, username: null, secret: "v1.x" };
    expect(readBook(old)).toMatchObject({ v: 2, accounts: [{ id: "a1", fromEmail: "a@kebo.test" }], defaultId: "a1", choose: true });
    expect(readBook(null)).toMatchObject({ accounts: [], defaultId: null });
    // An account removed by hand leaves no use pointing at it.
    expect(readBook({ v: 2, accounts: [{ ...old, id: "b" }], defaultId: "gone", uses: { customers: "gone" }, choose: false })).toMatchObject({ defaultId: "b", uses: { customers: null }, choose: false });
  });

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
    await mail.add(adminUser, { provider: "gmail", fromName: "Kebo", fromEmail: "kebo@gmail.com", secret: "abcd efgh ijkl mnop" });
    // Sealed, not as typed (and the spaces of an app password are dropped).
    const stored = rows.get("mail") as { accounts: { secret: string }[] };
    expect(stored.accounts[0]!.secret).toMatch(/^v1\./);
    expect(JSON.stringify(stored)).not.toContain("abcd");
    expect((await mail.mailer()).enabled).toBe(true);
    expect((await mail.mailer("customers", "unknown")).enabled).toBe(true);
    await mail.remove(adminUser);
    expect((await mail.mailer()).enabled).toBe(!!process.env.SMTP_HOST);
    // Someone who is not an admin is refused before anything is read.
    await expect(mail.view({ id: "u", companyId: "c", permissions: ["settings.manage"] } as never)).rejects.toThrow(/Only an admin/);
  });
});
