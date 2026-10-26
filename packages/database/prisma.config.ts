import "./scripts/env";
import path from "node:path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: { path: path.join("prisma", "migrations"), seed: "tsx scripts/seed.ts" },
  // `prisma generate` needs no database; migrate/seed do, and fail clearly when it is missing.
  datasource: { url: process.env.DATABASE_URL ?? "postgresql://unset:unset@localhost:5432/unset" },
});
