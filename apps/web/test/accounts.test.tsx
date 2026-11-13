import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// The account field and the "Recorded by" line that every money window carries (money, step 7).
const added = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/app/(app)/money/actions", () => ({
  quickAccountAction: async (...args: unknown[]) => {
    added.calls.push(args);
    return args[0] === "taken" ? { ok: false, message: "There is already an account called taken." } : { ok: true, id: "new-1" };
  },
}));

const { AccountSelect, AccountsProvider, RecordedBy } = await import("@/components/money/accounts");

const accounts = [
  { id: "a1", name: "Bank of China USD", kind: "bank" as const, currency: "USD", archived: false },
  { id: "a2", name: "Office cash USD", kind: "cash" as const, currency: "USD", archived: false },
  { id: "a3", name: "ICBC CNY", kind: "bank" as const, currency: "CNY", archived: false },
  { id: "a4", name: "Old USD", kind: "bank" as const, currency: "USD", archived: true },
];
const field = (props: Partial<Parameters<typeof AccountSelect>[0]> = {}, desk: { list?: typeof accounts; canAdd?: boolean } = {}) =>
  render(
    <AccountsProvider accounts={desk.list ?? accounts} me="Fawad Iqbal" canAdd={desk.canAdd ?? false}>
      <form>
        <AccountSelect id="acc" label="Into account" currency="USD" {...props} />
      </form>
    </AccountsProvider>,
  );
const select = () => screen.getByLabelText(/Into account/) as HTMLSelectElement;
const options = () => [...select().options].map((o) => o.textContent);

beforeEach(() => {
  window.localStorage.clear();
  added.calls = [];
});

describe("the account on a money window", () => {
  it("is always there, never required, and offers the open accounts in the same currency", () => {
    field();
    expect(screen.getByText("optional")).toBeTruthy();
    expect(options()).toEqual(["Not said", "Bank of China USD", "Office cash USD"]);
    expect(select().value).toBe("");
    expect(select().name).toBe("accountId");
  });

  it("with no account at all it still shows, and says who adds one", () => {
    field({}, { list: [] });
    expect(options()).toEqual(["Not said"]);
    expect(screen.getByText(/No USD account yet/).textContent).toContain("A manager adds accounts on Cash & bank.");
    expect(screen.queryByRole("button", { name: "Add one" })).toBeNull();
  });

  it("starts with the account used last for that currency, and remembers a new choice", async () => {
    window.localStorage.setItem("kebo:last-account:USD", "a2");
    field();
    await waitFor(() => expect(select().value).toBe("a2"));
    fireEvent.change(select(), { target: { value: "a1" } });
    expect(select().value).toBe("a1");
    expect(window.localStorage.getItem("kebo:last-account:USD")).toBe("a1");
  });

  it("an account already on the record wins over the remembered one; a closed one is offered only then", async () => {
    window.localStorage.setItem("kebo:last-account:USD", "a2");
    field({ defaultValue: "a4" });
    await waitFor(() => expect(select().value).toBe("a4"));
    expect(options()).toContain("Old USD (closed)");
  });

  it("a remembered account of another currency, or one that is gone, is not chosen", async () => {
    window.localStorage.setItem("kebo:last-account:USD", "a3");
    field();
    await new Promise((r) => setTimeout(r, 20));
    expect(select().value).toBe("");
  });

  it("a manager adds an account without leaving the window; a name already used says so", async () => {
    field({}, { list: [], canAdd: true });
    fireEvent.click(screen.getByRole("button", { name: "Add one" }));
    const name = screen.getByLabelText("Name of the new USD account");
    const add = screen.getByRole("button", { name: "Add the USD account" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(name, { target: { value: "taken" } });
    fireEvent.click(add);
    await waitFor(() => expect(screen.getByText("There is already an account called taken.")).toBeTruthy());
    fireEvent.change(name, { target: { value: "Meezan USD" } });
    fireEvent.click(screen.getByRole("button", { name: "Add the USD account" }));
    await waitFor(() => expect(screen.queryByLabelText("Name of the new USD account")).toBeNull());
    expect(added.calls.at(-1)).toEqual(["Meezan USD", "bank", "USD"]);
    // It is the one to use next time for this currency.
    expect(window.localStorage.getItem("kebo:last-account:USD")).toBe("new-1");
  });
});

describe("who records it", () => {
  const line = (verify?: boolean) =>
    render(
      <AccountsProvider accounts={[]} me="Sana Malik">
        <RecordedBy verify={verify} />
      </AccountsProvider>,
    ).container.textContent;

  it("every window names the person signed in", () => {
    expect(line()).toBe("Recorded by Sana Malik · today");
  });

  it("someone who sends it for a manager to verify is told it does not count yet", () => {
    expect(line(true)).toBe("Sent by Sana Malik · today · it counts once a manager verifies it");
  });
});
