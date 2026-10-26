import { describe, expect, it } from "vitest";
import { ENUMS } from "@kebo/shared";
import * as db from "../src/generated/prisma/enums";

/** The Prisma enums and @kebo/shared must list the same values, or the web and the database disagree. */
describe("enums stay in sync", () => {
  for (const [name, values] of Object.entries(ENUMS)) {
    it(name, () => {
      const prisma = (db as Record<string, Record<string, string> | undefined>)[name];
      expect(prisma, `Prisma enum ${name} is missing`).toBeDefined();
      expect(Object.values(prisma!).sort()).toEqual([...values].sort());
    });
  }
});
