import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { ErrorFilter } from "./common/http/error.filter";
import type { Env } from "./config/env";

/** Everything main.ts and the tests share: prefix, security headers, CORS, errors, API docs. */
export function configureApp(app: INestApplication, env: Env) {
  app.setGlobalPrefix("api");
  app.use(helmet());
  app.enableCors({ origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : false, credentials: true });
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  if (env.NODE_ENV !== "production") {
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle("Kebo API").setVersion("1").addBearerAuth().build());
    SwaggerModule.setup("api/docs", app, doc);
  }
  return app;
}
