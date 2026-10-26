"use server";

import { revalidatePath } from "next/cache";
import type { SettingsKey } from "@kebo/shared";
import { api } from "@/lib/api";
import { attempt, formValues, reasonOf, type ActionState } from "@/lib/actions";
import { SETTING_GROUPS } from "./groups";

const lines = (v: string | undefined, splitCommas = false) =>
  (v ?? "")
    .split(splitCommas ? /[\r\n,;]+/ : /\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

/** The schema's built-in messages, in plainer words. */
const plain = (m: string) =>
  m
    .replace(/^Too big: expected number to be <=?\s*(\S+)$/, "Use at most $1")
    .replace(/^Too small: expected number to be >=?\s*(\S+)$/, "Use at least $1")
    .replace(/^Too (small|big): expected string to have [<>]?=?\s*\d+ characters?$/, "Use a three-letter code, e.g. USD")
    .replace(/^Invalid email address$/, "One of these is not a valid email address")
    .replace(/^Invalid input: expected int, received number$/, "Use a whole number");

/** Turn one group's form into its settings object and save it (PUT /settings/:key). */
export async function saveSettingsAction(key: SettingsKey, _prev: ActionState, form: FormData): Promise<ActionState> {
  const group = SETTING_GROUPS.find((g) => g.key === key);
  if (!group) return { ok: false, message: "Unknown settings group." };
  const v = formValues(form);
  const body: Record<string, unknown> = {};
  const errors: Record<string, string[]> = {};
  for (const f of group.fields) {
    const raw = v[f.name];
    switch (f.kind) {
      case "bool":
        body[f.name] = raw === "on";
        break;
      case "number":
        if (!raw?.trim()) errors[f.name] = ["Enter a number"];
        else body[f.name] = raw.trim();
        break;
      case "lines":
        body[f.name] = lines(raw, f.name === "emails");
        break;
      case "rates": {
        const rates: Record<string, number> = {};
        lines(raw).forEach((line, i) => {
          const m = line.match(/^([A-Za-z]{3})\s*[=:]\s*(\d+(?:[.,]\d+)?)$/);
          if (!m) errors[f.name] = [`Line ${i + 1} ("${line}"): write it like CNY = 7.10`];
          else rates[m[1].toUpperCase()] = Number(m[2].replace(",", "."));
        });
        body[f.name] = rates;
        break;
      }
      default:
        body[f.name] = raw ?? "";
    }
  }
  if (Object.keys(errors).length) return { ok: false, message: "Some values need fixing.", errors, values: v };
  body.reason = reasonOf(form);
  const r = await attempt(form, () => api.put(`/settings/${key}`, body), `${group.title} saved.`);
  if (!r.ok && r.errors) r.errors = Object.fromEntries(Object.entries(r.errors).map(([k, ms]) => [k, ms?.map(plain)]));
  if (!r.ok && r.message) r.message = plain(r.message);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
