import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";

// Every form sends a one-time key (lib/once.ts): the same until the save goes through, so the API does a money
// save once when it is sent twice; a new one for the next save.
vi.mock("server-only", () => ({}));

const { ActionForm } = await import("@/components/common/action-form");

describe("a form's one-time key", () => {
  it("stays the same while the save fails or is sent again, and is new after it saves", async () => {
    const sent: Record<string, string>[] = [];
    let answer: { ok: boolean; message: string } = { ok: false, message: "No signal" };
    const action = vi.fn(async (_prev: unknown, form: FormData) => {
      sent.push(Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])));
      return answer;
    });
    render(
      <ActionForm action={action}>
        <input name="amount" defaultValue="5" />
        <button>Save</button>
      </ActionForm>,
    );
    const form = document.querySelector("form")!;
    const send = () =>
      act(async () => {
        fireEvent.submit(form);
      });
    await send();
    await send();
    answer = { ok: true, message: "Saved." };
    await send();
    await send();
    const keys = sent.map((s) => s.onceKey);
    expect(keys).toHaveLength(4);
    expect(keys[0]).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).toBe(keys[0]);
    expect(keys[3]).not.toBe(keys[0]);
    expect(sent[0]).toMatchObject({ amount: "5" });
  });
});
