import { describe, expect, it } from "vitest";
import { LIFECYCLE, lifecycleStep, type LifecycleInput } from "../src";

const DAY = 86_400_000;
const now = new Date("2026-06-15T12:00:00Z");
const today = "2026-06-15";
const ago = (days: number) => new Date(now.getTime() - days * DAY);
const trial = (c: Partial<LifecycleInput> = {}): LifecycleInput => ({
  kind: "trial",
  status: "off",
  statusManual: false,
  endsAt: ago(LIFECYCLE.readOnlyDays + LIFECYCLE.deleteAfterOffDays + 1),
  renewsOn: null,
  endingNoticeFor: null,
  hasPayments: false,
  ...c,
});

describe("automatic rules for demos and trials", () => {
  it("delete an ended demo or trial after the off days", () => {
    expect(lifecycleStep(trial(), now, today).do).toBe("delete");
    expect(lifecycleStep(trial({ kind: "demo" }), now, today).do).toBe("delete");
  });

  it("read-only when it ends, off after the read-only days", () => {
    expect(lifecycleStep(trial({ status: "active", endsAt: ago(1) }), now, today)).toMatchObject({ do: "status", status: "read_only" });
    expect(lifecycleStep(trial({ status: "read_only", endsAt: ago(LIFECYCLE.readOnlyDays + 1) }), now, today)).toMatchObject({
      do: "status",
      status: "off",
    });
  });

  it("never delete one whose status was set by hand, whatever the status", () => {
    for (const status of ["active", "read_only", "off"] as const) {
      expect(lifecycleStep(trial({ statusManual: true, status }), now, today), status).toEqual({ do: "nothing" });
    }
  });

  it("never delete one that has paid, or is paid until a date not yet passed", () => {
    expect(lifecycleStep(trial({ hasPayments: true }), now, today)).toEqual({ do: "nothing" });
    expect(lifecycleStep(trial({ hasPayments: true, status: "active" }), now, today)).toMatchObject({ do: "status", status: "off" });
    expect(lifecycleStep(trial({ renewsOn: "2026-07-01" }), now, today)).toEqual({ do: "nothing" });
    expect(lifecycleStep(trial({ renewsOn: today }), now, today)).toEqual({ do: "nothing" });
    // Paid until a date long gone, with no payment recorded: deleted as usual.
    expect(lifecycleStep(trial({ renewsOn: "2026-01-01" }), now, today).do).toBe("delete");
  });

  it("never delete a client", () => {
    const client = trial({ kind: "client", renewsOn: "2025-01-01", status: "off" });
    expect(lifecycleStep(client, now, today)).toEqual({ do: "nothing" });
  });
});
