import { z } from "zod";
import { PERMISSIONS } from "../permissions";
import { bool, optionalText, text } from "./common";

/**
 * A role made or changed under Security. Its key is made from the name once and
 * never changes, so renaming a role keeps everyone in it.
 */
export const roleInput = z.object({
  name: text(60, "Give the role a name"),
  description: optionalText(300),
  /** Checkboxes send one value each; a single one may arrive as a string. */
  permissions: z.preprocess(
    (v) => (v == null ? [] : Array.isArray(v) ? v : [v]),
    z.array(z.enum(PERMISSIONS, "Unknown permission")).max(PERMISSIONS.length),
  ),
  /** Everyone in the role must use two-step sign-in. */
  requireTwoStep: bool,
});
export type RoleInput = z.infer<typeof roleInput>;

/** "Accounts (China)" → "accounts-china". */
export const roleKeyOf = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "role";
