import { expect, type Page } from "@playwright/test";

export interface Person {
  email: string;
  password: string;
  name: string;
}

/** The demo's people (pnpm db:seed --demo; SEED_* change them). */
export const ADMIN: Person = {
  email: process.env.SEED_ADMIN_EMAIL ?? "admin@example.com",
  password: process.env.SEED_ADMIN_PASSWORD ?? "Admin@12345",
  name: "Super Admin",
};
export const MANAGER: Person = {
  email: process.env.SEED_MANAGER_EMAIL ?? "manager@example.com",
  password: process.env.SEED_MANAGER_PASSWORD ?? "Manager@12345",
  name: "Manager",
};

/** Signs in through the form, as a person does, and waits for Home. */
export async function signIn(page: Page, who: Person) {
  await page.goto("/login");
  await page.locator("#email").fill(who.email);
  await page.locator("#password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}
