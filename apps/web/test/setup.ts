import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// The app router is not mounted in a component test.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/customers",
}));

// Server actions ("use server" files) are plain modules in a component test: their server-only guard stays quiet.
vi.mock("server-only", () => ({}));

afterEach(() => cleanup());
