import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ButtonLink, PageHeader, StatusBadge } from "@kebo/ui";

describe("PageHeader", () => {
  it("has one primary slot: papers and ⋯ stay secondary, so a page shows at most one primary", () => {
    const { container } = render(
      <PageHeader
        title="SO-2026-0447"
        badge={<StatusBadge meaning="info">Shipped</StatusBadge>}
        summary="Lahore Pharma · DPP-250 blister machine · USD 34,639.60 · LC · Sana"
        papers={
          <>
            <ButtonLink href="/print">View / Print</ButtonLink>
            <ButtonLink href="/pdf">Download PDF</ButtonLink>
          </>
        }
        primary={
          <ButtonLink href="/pay" variant="primary">
            Record a payment
          </ButtonLink>
        }
        more={<button aria-label="More actions">⋯</button>}
      />,
    );
    expect(container.querySelectorAll(".bg-primary-solid")).toHaveLength(1);
    expect(container.querySelectorAll("[data-slot=primary]")).toHaveLength(1);
    // Paper buttons fold away on a phone (they move into ⋯).
    expect(container.querySelector("[data-slot=papers]")?.className).toContain("max-sm:hidden");
    // Title, then status as word + dot, then the summary line.
    expect(container.querySelector("h1")?.textContent).toBe("SO-2026-0447");
    expect(container.textContent).toContain("Shipped");
    expect(container.textContent).toContain("USD 34,639.60");
  });

  it("without a primary there is none", () => {
    const { container } = render(<PageHeader title="Customers" summary="38 customers" />);
    expect(container.querySelectorAll(".bg-primary-solid")).toHaveLength(0);
    expect(container.querySelector("[data-slot=primary]")).toBeNull();
  });
});

describe("StatusBadge", () => {
  it("carries the word and a dot in the colour of one of five meanings", () => {
    const { container } = render(
      <>
        <StatusBadge meaning="neutral">Draft</StatusBadge>
        <StatusBadge meaning="info">Sent</StatusBadge>
        <StatusBadge meaning="ok">Paid</StatusBadge>
        <StatusBadge meaning="warn">Due soon</StatusBadge>
        <StatusBadge meaning="bad">Late</StatusBadge>
      </>,
    );
    const badges = [...container.querySelectorAll("span.inline-flex")];
    expect(badges.map((b) => b.textContent)).toEqual(["Draft", "Sent", "Paid", "Due soon", "Late"]);
    expect(badges[4]!.className).toContain("text-bad");
    expect(badges.every((b) => b.querySelector("[aria-hidden]"))).toBe(true);
  });
});
