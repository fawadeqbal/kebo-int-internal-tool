import { afterAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@kebo/database";

/** The database's shape, checked: what keeps it fast as the data grows. */
describe("the database's indexes", () => {
  const db = createPrismaClient({ url: process.env.DATABASE_URL!, poolSize: 1 });
  afterAll(async () => {
    await db.$disconnect();
  });

  it("every foreign key has an index (joins, and the checks when a record is removed, read no whole table)", async () => {
    const missing = await db.$queryRaw<{ tbl: string; col: string }[]>`
      select c.conrelid::regclass::text as tbl, a.attname as col
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.contype = 'f' and array_length(c.conkey, 1) = 1
         and c.connamespace = current_schema()::regnamespace
         and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])
       order by 1, 2`;
    expect(missing.map((m) => `${m.tbl}.${m.col}`)).toEqual([]);
  });
});
