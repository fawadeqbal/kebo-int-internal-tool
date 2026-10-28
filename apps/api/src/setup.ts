import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { ErrorFilter } from "./common/http/error.filter";
import { ReadCache } from "./common/cache/read-cache";
import { CompanyResolver } from "./common/company/company-resolver";
import { CompanyContext } from "./common/company/company-context";
import type { Env } from "./config/env";

/** Everything main.ts and the tests share: prefix, security headers, CORS, errors, API docs. */

export function configureApp(app: INestApplication, env: Env) {
  app.setGlobalPrefix("api");
  // req.ip honours X-Forwarded-For only for the configured number of proxy hops.
  (app.getHttpAdapter().getInstance() as { set(key: string, value: unknown): void }).set("trust proxy", env.TRUST_PROXY);
  app.use(helmet());
  // Room for the company stamp image in the settings (a data URL of up to ~400 KB).
  (app as NestExpressApplication).useBodyParser("json", { limit: "1mb" });
  app.enableCors({ origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : false, credentials: true });
  app.useGlobalFilters(new ErrorFilter());
  // Which company the request works in; everything after runs inside it (see CompanyResolver).
  app.use(app.get(CompanyResolver).middleware());
  // A change that went through drops that company's remembered heavy reads (see ReadCache).
  const cache = app.get(ReadCache);
  app.use((req: { method: string }, res: { statusCode: number; on(event: "finish", fn: () => void): void }, next: () => void) => {
    const company = CompanyContext.current()?.id;
    if (company && req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") res.on("finish", () => res.statusCode < 400 && cache.bump(company));
    next();
  });
  app.enableShutdownHooks();
  if (env.NODE_ENV !== "production") {
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle("RFQ Desk API").setVersion("1").addBearerAuth().build());
    SwaggerModule.setup("api/docs", app, doc);
  }
  return app;
}
