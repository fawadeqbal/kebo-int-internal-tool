import { describe, expect, it, vi } from "vitest";
import { saveThenSend } from "../src";

/** The payment form's slip: sent right after the payment is saved, by its new id, whatever the page does next. */
describe("saveThenSend", () => {
  const file = { name: "bank slip.png" };

  it("sends the file with the new record's id, inside the same call as the save", async () => {
    const order: string[] = [];
    const send = vi.fn(async (id: string) => {
      order.push(`send ${id}`);
      return null;
    });
    const r = await saveThenSend(
      async () => {
        order.push("save");
        return { ok: true, message: "Payment recorded.", data: { createdId: "p-1", payments: [] } };
      },
      file,
      send,
    );
    expect(send).toHaveBeenCalledWith("p-1");
    expect(order).toEqual(["save", "send p-1"]);
    expect(r).toMatchObject({ ok: true, message: "Payment recorded.", fileError: null });
  });

  it("sends nothing when the save failed or there is no file", async () => {
    const send = vi.fn(async () => null);
    expect(await saveThenSend(async () => ({ ok: false, message: "Enter the amount" }), file, send)).toEqual({ ok: false, message: "Enter the amount" });
    expect(await saveThenSend(async () => ({ ok: true, data: { createdId: "p-2" } }), null, send)).toEqual({ ok: true, data: { createdId: "p-2" } });
    expect(send).not.toHaveBeenCalled();
  });

  it("says when the file did not follow: the upload's error, a dropped connection, or no id", async () => {
    const saved = async () => ({ ok: true, data: { createdId: "p-3" } });
    expect((await saveThenSend(saved, file, async () => "This file is too large.")).fileError).toBe("This file is too large.");
    expect(
      (
        await saveThenSend(saved, file, async () => {
          throw new Error("offline");
        })
      ).fileError,
    ).toMatch(/connection dropped/);
    expect((await saveThenSend(async () => ({ ok: true, data: {} }), file, async () => null)).fileError).toMatch(/without its id/);
    // Another id field (an expense's own id).
    const send = vi.fn(async () => null);
    await saveThenSend(async () => ({ ok: true, data: { id: "e-1" } }), file, send, (d) => (d as { id: string }).id);
    expect(send).toHaveBeenCalledWith("e-1");
  });
});
