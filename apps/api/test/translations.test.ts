import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIRST_COMPANY_ID } from "@kebo/database";
import { api, signIn, startApp } from "./app";
import { PrismaService } from "../src/database/prisma.service";
import { CompaniesService } from "../src/common/company/companies.service";
import { CompanyContext } from "../src/common/company/company-context";
import { TranslationsService } from "../src/modules/translations/translations.service";

/**
 * The translator (25 Nov 2026): papers ask for their texts' Chinese; the worker translates what waits, once, on
 * the server's own translator (here a stand-in that answers like llama.cpp's server); people check and correct,
 * and a person's Chinese always wins, the order's items included.
 */
describe("the translator", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sana: string;
  let translator: Server;
  const asked: string[] = [];
  let down = false;
  const tag = Date.now().toString(36);

  beforeAll(async () => {
    // A stand-in for llama.cpp's server: /health, and /v1/chat/completions answering "中文:" and the text's last line.
    translator = createServer((req, res) => {
      if (down) return void res.writeHead(503).end();
      if (req.url === "/health") return void res.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}');
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const prompt = (JSON.parse(body) as { messages: { content: string }[] }).messages[0]!.content;
        asked.push(prompt);
        const text = prompt.split("\n\n").at(-1)!;
        const answer = text.includes("nonsense") ? "Sorry, I cannot." : `中文：${text.split("\n").map((l) => `译${l.length}`).join("\n")}`;
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
      });
    });
    await new Promise<void>((r) => translator.listen(0, "127.0.0.1", r));
    process.env.TRANSLATE_URL = `http://127.0.0.1:${(translator.address() as AddressInfo).port}`;
    app = await startApp();
    prisma = app.get(PrismaService);
    sana = await signIn(app, "sana@example.com");
  });

  afterAll(async () => {
    delete process.env.TRANSLATE_URL;
    for (const b of borrowed)
      await inCompany(() => prisma.db.orderLine.update({ where: { id: b.id }, data: { description: b.description, descriptionZh: b.descriptionZh, zhBy: b.zhBy } }));
    await app?.close();
    translator?.close();
  });

  const inCompany = async <T>(fn: () => Promise<T>) => CompanyContext.run((await app.get(CompaniesService).byId(FIRST_COMPANY_ID))!, fn);
  /** The worker's two beats: items without a Chinese name are looked at, then what waits is translated. */
  const work = () =>
    inCompany(async () => {
      await app.get(TranslationsService).nameItems();
      return app.get(TranslationsService).work();
    });
  /** Everything that waits, translated (other tests' order items too: they wait in the same queue). */
  const drain = async () => {
    let n = 0;
    for (let i = 0; i < 100; i++) {
      const k = await work();
      if (!k) break;
      n += k;
    }
    return n;
  };
  /** An order item for a test: a goods line given this description and no Chinese (put back as it was afterwards). */
  const borrowed: { id: string; description: string; descriptionZh: string | null; zhBy: string | null }[] = [];
  const itemNamed = async (description: string) =>
    inCompany(async () => {
      const l = await prisma.db.orderLine.findFirst({
        where: { type: "goods", order: { status: { not: "cancelled" } }, id: { notIn: borrowed.map((b) => b.id) } },
        select: { id: true, description: true, descriptionZh: true, zhBy: true },
        orderBy: { id: "desc" },
      });
      borrowed.push(l!);
      await prisma.db.orderLine.update({ where: { id: l!.id }, data: { description, descriptionZh: null, zhBy: null } });
      return l!.id;
    });
  const zhOfLine = (id: string) => inCompany(() => prisma.db.orderLine.findUnique({ where: { id }, select: { descriptionZh: true, zhBy: true } }));
  const lookup = async (texts: string[]) =>
    (await api(app, sana).post("/translations/lookup", { texts }).expect(200)).body as { found: Record<string, string>; waiting: number };

  it("a paper asks; the worker translates each text once, with the glossary's words; the paper then prints it", async () => {
    // The worker's short beat goes to the companies with something waiting.
    await lookup([`Something waiting for the worker ${tag}`]);
    expect(await app.get(TranslationsService).dueCompanyIds()).toContain(FIRST_COMPANY_ID);
    const sentence = `Shipped by sea from Qingdao, ${tag}.`;
    const blister = `Blister packing machine ${tag}, 4 heads`;
    let r = await lookup([sentence, blister, "8422.30", "LC", "已经是中文"]);
    // Numbers, codes and one word are never asked for; Chinese neither.
    expect(r.waiting).toBe(2);
    expect(r.found).toEqual({});
    expect(await drain()).toBeGreaterThanOrEqual(2);
    r = await lookup([sentence, `  ${blister}  `]);
    expect(r.waiting).toBe(0);
    expect(r.found[sentence]).toBe(`译${sentence.length}`);
    // The same text again (spaces round it): the same row, not translated again.
    expect(r.found[blister]).toBeTruthy();
    expect(await work()).toBe(0);
    // Our words went with the text that has them.
    const prompt = asked.find((p) => p.includes(blister))!;
    expect(prompt).toContain("Blister packing machine 翻译成 泡罩包装机");
    expect(prompt).toContain("heads 翻译成 头");
    expect(prompt).not.toContain("Qingdao 翻译成");
  });

  it("an answer that is no Chinese waits to be tried again; a translator that cannot answer stops the turn", async () => {
    const odd = `Some nonsense here ${tag}`;
    await lookup([odd]);
    await drain();
    const list = (await api(app, sana).get("/translations?show=failed").expect(200)).body as { rows: { source: string; tries: number; status: string }[] };
    expect(list.rows.find((x) => x.source === odd)).toMatchObject({ status: "failed", tries: 1 });
    down = true;
    try {
      await lookup([`Another sentence for later ${tag}`]);
      expect(await work()).toBe(0);
      const status = (await api(app, sana).get("/translations/status").expect(200)).body;
      expect(status.state).toBe("starting");
      expect(status.counts.waiting).toBeGreaterThan(0);
    } finally {
      down = false;
    }
  });

  it("people check and correct; a person's Chinese wins, on the order's items too", async () => {
    // An order item named by the translator.
    const description = `Vial filling machine ${tag}\nwith 4 nozzles`;
    const lineId = await itemNamed(description);
    await drain();
    const named = await zhOfLine(lineId);
    expect(named).toMatchObject({ zhBy: "machine" });
    expect(named!.descriptionZh).toMatch(/^译/);

    const toCheck = (await api(app, sana).get(`/translations?show=check&q=${encodeURIComponent(tag)}`).expect(200)).body as { rows: { id: string; source: string }[] };
    const row = toCheck.rows.find((x) => x.source === description)!;
    expect(row).toBeTruthy();
    // Not Chinese: refused.
    await api(app, sana).patch(`/translations/${row.id}`, { zh: "blister" }).expect(422);
    const fixed = (await api(app, sana).patch(`/translations/${row.id}`, { zh: "泡罩包装机（测试）" }).expect(200)).body;
    expect(fixed).toMatchObject({ zh: "泡罩包装机（测试）", by: "staff", checkedBy: expect.any(String) });
    expect(await zhOfLine(lineId)).toEqual({ descriptionZh: "泡罩包装机（测试）", zhBy: "staff" });
    // A person's: not translated again.
    await api(app, sana).post(`/translations/${row.id}/again`).expect(403);

    // Right: the translator's becomes checked.
    const other = `Sterilizing tunnel ${tag} with hot air`;
    await lookup([other]);
    await drain();
    const o = ((await api(app, sana).get(`/translations?show=check&q=${encodeURIComponent(tag)}`).expect(200)).body as { rows: { id: string; source: string }[] }).rows.find(
      (x) => x.source === other,
    )!;
    expect((await api(app, sana).post(`/translations/${o.id}/check`).expect(200)).body).toMatchObject({ by: "staff" });
    // And Again for the translator's: it waits once more.
    const s = ((await api(app, sana).get(`/translations?show=all&q=${encodeURIComponent(`Shipped by sea from Qingdao, ${tag}`)}`).expect(200)).body as { rows: { id: string }[] }).rows[0]!;
    expect((await api(app, sana).post(`/translations/${s.id}/again`).expect(200)).body).toMatchObject({ status: "waiting", zh: null });
  });

  it("an item's Chinese typed on the order is remembered for the next order", async () => {
    const description = `Labelling machine ${tag} for round bottles`;
    const lineId = await itemNamed(description);
    await api(app, sana).patch(`/order-lines/${lineId}`, { set: "customs", descriptionZh: `圆瓶贴标机 ${tag}` }).expect(200);
    expect(await zhOfLine(lineId)).toEqual({ descriptionZh: `圆瓶贴标机 ${tag}`, zhBy: "staff" });
    // The memory has it as a person's: a paper, or the same item on the next order, gets it.
    const r = await lookup([description]);
    expect(r.found[description]).toBe(`圆瓶贴标机 ${tag}`);
  });

  it("the review needs the right to make documents", async () => {
    const bilal = await signIn(app, "bilal@example.com");
    const me = (await api(app, bilal).get("/auth/me").expect(200)).body as { permissions: string[] };
    if (!me.permissions.includes("documents.manage")) await api(app, bilal).get("/translations").expect(403);
    // Asking for a paper's Chinese: anyone signed in.
    await api(app, bilal).post("/translations/lookup", { texts: [] }).expect(200);
    await api(app).post("/translations/lookup").send({ texts: [] }).expect(401);
  });
});
