import { z } from "zod";

/**
 * Typed environment loading. Each app declares the variables it needs with Zod
 * and gets a frozen, validated object, failing fast at start-up with every
 * problem listed at once (instead of crashing later on a missing value).
 */
export class EnvError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment:\n  - ${issues.join("\n  - ")}`);
    this.name = "EnvError";
  }
}

export function loadEnv<S extends z.ZodType>(schema: S, source: Record<string, string | undefined> = process.env): Readonly<z.infer<S>> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new EnvError(parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  }
  return Object.freeze(parsed.data);
}

/** Building blocks for env schemas. */
export const envField = {
  url: () => z.url(),
  port: (fallback: number) => z.coerce.number().int().min(1).max(65535).default(fallback),
  bool: (fallback: boolean) =>
    z
      .enum(["true", "false", "1", "0", "yes", "no"])
      .default(fallback ? "true" : "false")
      .transform((v) => v === "true" || v === "1" || v === "yes"),
  list: () =>
    z
      .string()
      .default("")
      .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
  secret: (min = 32) => z.string().min(min, `must be at least ${min} characters`),
  timeZone: (fallback: string) =>
    z
      .string()
      .default(fallback)
      .refine((tz) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, "must be a valid IANA time zone"),
};

/** The server-side settings every backend process (API, worker, scripts) shares. */
export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "is required (postgres://user:pass@host:5432/db)"),
  AUTH_SECRET: envField.secret(),
  APP_URL: z.url().default("http://localhost:3000"),
  APP_TIME_ZONE: envField.timeZone("Asia/Shanghai"),
  API_PORT: envField.port(4000),
  CORS_ORIGINS: envField.list(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export const loadServerEnv = (source?: Record<string, string | undefined>) => loadEnv(serverEnvSchema, source);
