import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LocalDiskStorage } from "@/lib/storage/local";
import { isAllowedFile, safeFileName } from "@/lib/storage";

const dir = mkdtempSync(path.join(tmpdir(), "kebo-files-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("file storage", () => {
  it("stores, reads back and deletes a file", async () => {
    const store = new LocalDiskStorage(dir);
    await store.put("queries/a/spec.pdf", Buffer.from("%PDF-1.4 test"), "application/pdf");
    const text = await new Response(await store.getStream("queries/a/spec.pdf")).text();
    expect(text).toBe("%PDF-1.4 test");
    await store.delete("queries/a/spec.pdf");
    await expect(store.getStream("queries/a/spec.pdf")).rejects.toThrow();
  });

  it("refuses keys that escape the storage folder", async () => {
    await expect(new LocalDiskStorage(dir).put("../outside.txt", Buffer.from("x"), "text/plain")).rejects.toThrow("Invalid storage key");
  });

  it("only accepts expected file types and safe names", () => {
    expect(isAllowedFile("layout.DWG")).toBe(true);
    expect(isAllowedFile("setup.exe")).toBe(false);
    expect(safeFileName("../../etc/passwd")).not.toContain("/");
  });
});
