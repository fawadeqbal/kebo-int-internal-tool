import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

// A list's search finds as you type: it waits for the typing to pause, and what is typed while it looks stays.
const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, refresh: vi.fn() }),
  usePathname: () => "/inquiries",
  useSearchParams: () => new URLSearchParams(),
}));

const { FilterCard, SEARCH_PAUSE_MS } = await import("@/components/common/filter-card");

const box = () => screen.getByRole("searchbox") as HTMLInputElement;
/** Types like a person: one letter at a time, `gap` ms between them. */
const type = (letters: string, gap = 150) => {
  for (const k of letters) {
    fireEvent.change(box(), { target: { value: box().value + k } });
    act(() => {
      vi.advanceTimersByTime(gap);
    });
  }
};
const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const card = (q?: string) => <FilterCard search="Search number, title, customer…" value={q} keep={{ stage: "new" }} />;

beforeEach(() => {
  vi.useFakeTimers();
  push.mockClear();
  replace.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("the search box", () => {
  it("does not look between the letters of a word, only when the typing pauses", () => {
    render(card());
    // A slow typist (a phone's keyboard): half a second between letters.
    type("bottling", 500);
    expect(push).not.toHaveBeenCalled();
    wait(SEARCH_PAUSE_MS);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/inquiries?stage=new&q=bottling", { scroll: false });
  });

  it("keeps what was typed while it looked: the page coming back does not take letters away", () => {
    const { rerender } = render(card());
    type("bott");
    wait(SEARCH_PAUSE_MS); // a pause: it looks for "bott"
    expect(push).toHaveBeenLastCalledWith("/inquiries?stage=new&q=bott", { scroll: false });
    type("ling line"); // typing on while it looks
    rerender(card("bott")); // the page comes back with "bott"
    expect(box().value).toBe("bottling line");
    type(""); // nothing more typed
    wait(SEARCH_PAUSE_MS);
    // Then it looks for all of it, replacing the search it made (Back goes to the list before searching).
    expect(replace).toHaveBeenLastCalledWith("/inquiries?stage=new&q=bottling+line", { scroll: false });
    rerender(card("bottling line"));
    expect(box().value).toBe("bottling line");
  });

  it("does not look again for a search on its way", () => {
    render(card());
    type("valve");
    wait(SEARCH_PAUSE_MS);
    wait(SEARCH_PAUSE_MS * 3);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("looks at once on Enter", () => {
    render(card());
    type("pump", 100);
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/inquiries?stage=new&q=pump", { scroll: false });
    wait(SEARCH_PAUSE_MS * 2);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("follows the page when the search changes elsewhere (Back, a tab, a link)", () => {
    const { rerender } = render(card("bottling"));
    expect(box().value).toBe("bottling");
    rerender(card(undefined)); // Back to the list before the search
    expect(box().value).toBe("");
    rerender(card("valve")); // a link with a search in it
    expect(box().value).toBe("valve");
    wait(SEARCH_PAUSE_MS * 2);
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("empties with ×, and the list with it", () => {
    render(card("bottling"));
    fireEvent.click(screen.getByRole("button", { name: "Empty the search" }));
    expect(box().value).toBe("");
    expect(push).toHaveBeenCalledWith("/inquiries?stage=new", { scroll: false });
  });
});
