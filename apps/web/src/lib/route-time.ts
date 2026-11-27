import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { TimeStyle } from "@kebo/utils";
import { setRouteTimeSource } from "./format";
import { api } from "./api";
import { timeStyleOf, type Me } from "./session";

const store = new AsyncLocalStorage<TimeStyle>();
setRouteTimeSource(() => store.getStore());

/**
 * Runs a route handler's work in the company's time (zone and formats, from the session), so the days and times
 * in a file it makes (an Excel or CSV export) are the company's, as on its pages. When the session cannot be read the
 * route fails as its own reads would (signed out: "Sign in again"), rather than making a file in the server's time.
 */
export async function withCompanyTime<T>(work: () => Promise<T>): Promise<T> {
  const me = await api.get<Me>("/auth/me");
  return store.run(timeStyleOf(me), work);
}
