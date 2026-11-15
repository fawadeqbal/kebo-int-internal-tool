import type { INestApplication } from "@nestjs/common";
import { createServer, type Server } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanWithClamd } from "../src/common/storage/virus-scan";
import request from "supertest";
import { api, signIn, startApp } from "./app";
import { Clock } from "../src/common/time/clock.service";

/** A stand-in for clamd: reads INSTREAM and finds a "virus" in any file holding the EICAR test text. */
function fakeClamd(): Promise<{ server: Server; address: string }> {
  return new Promise((resolve) => {
    const server = createServer((socket) => {
      const got: Buffer[] = [];
      socket.on("data", (d) => got.push(d));
      socket.on("end", () => {
        const all = Buffer.concat(got);
        socket.end(all.includes(Buffer.from("EICAR")) ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0");
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const a = server.address() as { port: number };
      resolve({ server, address: `127.0.0.1:${a.port}` });
    });
  });
}

describe("uploads are checked for viruses (CLAMAV_HOST)", () => {
  let clamd: { server: Server; address: string };
  let app: INestApplication;
  let manager: string;
  let today = "";
  const tag = Date.now().toString(36);

  beforeAll(async () => {
    clamd = await fakeClamd();
    process.env.CLAMAV_HOST = clamd.address;
    app = await startApp();
    today = app.get(Clock).today();
    manager = await signIn(app, "manager@example.com", "Manager@12345");
  });
  afterAll(async () => {
    delete process.env.CLAMAV_HOST;
    await app?.close();
    clamd.server.close();
  });

  it("clamd's answers: clean, a virus by name, no answer", async () => {
    expect(await scanWithClamd(clamd.address, Buffer.from("a plain receipt"))).toEqual({ clean: true });
    expect(await scanWithClamd(clamd.address, Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!"))).toEqual({
      clean: false,
      virus: "Eicar-Test-Signature",
    });
    await expect(scanWithClamd("127.0.0.1:1", Buffer.from("x"), 2000)).rejects.toThrow();
  });

  it("a file with a virus is not kept; a clean one is", async () => {
    const e = (await api(app, manager).post("/expenses", { category: "office", description: `Scanned ${tag}`, amount: 10, currency: "USD", spentOn: today }).expect(201)).body;
    const send = (text: string) =>
      request(app.getHttpServer())
        .post(`/api/expenses/${e.id}/receipt`)
        .set("authorization", `Bearer ${manager}`)
        .attach("file", Buffer.from(text), { filename: "receipt.pdf", contentType: "application/pdf" });
    const refused = await send("%PDF-1.4 EICAR test").expect(400);
    expect(refused.body.error).toBe("This file holds a virus (Eicar-Test-Signature): it was not kept.");
    const kept = await send("%PDF-1.4 a clean receipt");
    expect([200, 201]).toContain(kept.status);
  });
});
