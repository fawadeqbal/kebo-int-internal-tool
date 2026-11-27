import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The real one: unstable_rethrow() is what is tested (test/setup.ts mocks it for components).
vi.mock("next/navigation", async (real) => await real());
const toast = vi.fn();
vi.mock("@kebo/ui/client", () => ({ toast: (x: unknown) => toast(x) }));
const recordEditAction = vi.fn();
vi.mock("@/lib/edit-actions", () => ({ recordEditAction: (x: unknown) => recordEditAction(x) }));

import { redirect } from "next/navigation";
import { bestEffort, bodyOf, ignore } from "@/lib/quiet";
import { editNotes } from "@/components/edits/edit-notes";

afterEach(() => {
  vi.restoreAllMocks();
  toast.mockReset();
  recordEditAction.mockReset();
});

/** Failures that may stay quiet, each named (lib/quiet.ts): logged with why, never swallowed silently. */
describe("quiet", () => {
  it("ignore: logs the step and why it may be quiet, and gives nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await Promise.reject(new Error("tab closed")).catch(ignore("closing the page that made a PDF"))).toBeUndefined();
    expect(warn.mock.calls.map((c) => c[0])).toEqual(["[ignored] closing the page that made a PDF: tab closed"]);
  });

  it("ignore silent: only for the error reports themselves (a failed report must not report itself)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await Promise.reject(new Error("offline")).catch(ignore("a report", { silent: true }));
    expect(warn).not.toHaveBeenCalled();
  });

  it("bestEffort: the step's answer, or nothing (logged) when it failed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await bestEffort("signing out at the API", Promise.resolve(7))).toBe(7);
    expect(await bestEffort("signing out at the API", Promise.reject(new TypeError("fetch failed")))).toBeUndefined();
    expect(warn.mock.calls[0]?.[0]).toBe("[ignored] signing out at the API: fetch failed");
  });

  it("never quiets Next's own redirect: it goes on", async () => {
    await expect(bestEffort("marking it read", (async () => redirect("/login"))())).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    await expect((async () => redirect("/login"))().catch(ignore("anything"))).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
  });

  it("bodyOf: the JSON body; null for none, or words that are not JSON (a proxy's error page)", async () => {
    expect(await bodyOf(new Response(JSON.stringify({ error: "Too large" }), { status: 413 }))).toEqual({ error: "Too large" });
    expect(await bodyOf(new Response("", { status: 500 }))).toBeNull();
    expect(await bodyOf(new Response("<html>Bad gateway</html>", { status: 502 }))).toBeNull();
    // A request's body too (a route reading what the browser sent).
    expect(await bodyOf(new Request("http://x/", { method: "POST", body: '{"name":"a"}' }))).toEqual({ name: "a" });
  });

  it("bodyOf: a body that broke off is logged, and read as none", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const broken = { text: () => Promise.reject(new Error("socket hang up")) };
    expect(await bodyOf(broken)).toBeNull();
    expect(warn.mock.calls[0]?.[0]).toBe("[ignored] reading an answer's words: socket hang up");
  });
});

/** After a save, the notes of what changed (each box's history): one not kept is said, once; the save stands. */
describe("editNotes", () => {
  const note = { type: "inquiry", id: "d1", card: "request.items", kind: "edit", reason: "Customer asked", changes: [], keys: [] } as const;

  it("says nothing when every note is kept", async () => {
    recordEditAction.mockResolvedValue({ ok: true, n: 2 });
    const notes = editNotes();
    await notes.keep(note);
    await notes.keep(note);
    notes.tell();
    expect(toast).not.toHaveBeenCalled();
  });

  it("says once, as partly done, when the API refused a note or the connection dropped", async () => {
    recordEditAction
      .mockResolvedValueOnce({ ok: false, message: "Request failed (500)" })
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const notes = editNotes();
    await notes.keep(note);
    await notes.keep(note);
    notes.tell();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({
      kind: "part",
      message: "Saved, but the note of what changed was not kept",
      detail: "Request failed (500). The history may not show this change.",
    });
  });
});
