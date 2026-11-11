import "server-only";
import { cache } from "react";
import type { Settings } from "@kebo/shared";
import { api } from "@/lib/api";
import type { PersonWithRole } from "@/lib/types-deals";

/**
 * Reads that many parts of one page need. Each is asked from the API once per request, however
 * many layouts, pages and cards call it (React's cache), so a page never loads the same thing twice
 * and no file writes its own copy of the call.
 */

/** The company's settings: sales (currency, rates), company (name, logo, letterhead), papers, reminders… */
export const getSettings = cache(() => api.get<Settings>("/settings"));

/** Everyone who can be picked as a person: id, name and role. */
export const getPeople = cache(() => api.get<PersonWithRole[]>("/users/people"));
