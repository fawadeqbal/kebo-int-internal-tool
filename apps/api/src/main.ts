import "./load-env";
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ENV, type Env } from "./config/env";
import { configureApp } from "./setup";
import { DocumentsService } from "./modules/orders/documents.service";
import { FactsService } from "./modules/insights/facts/facts.service";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const env = app.get<Env>(ENV);
  configureApp(app, env);
  await app.listen(env.API_PORT);
  Logger.log(`API on http://localhost:${env.API_PORT}/api (docs at /api/docs)`, "Bootstrap");
  // Proformas issued (and packing lists shipped) before their snapshots were kept: snapshot them once, from the data.
  // Then Insights' calculated tables: filled when empty (first start, a restore) and caught up on what was queued.
  // One after the other: each walks the companies one at a time (their connections are opened and closed in turn).
  void app
    .get(DocumentsService)
    .rebuildAll()
    .catch((e) => Logger.error(`snapshots from the data: ${(e as Error).stack ?? e}`, "Bootstrap"))
    .then(() => app.get(FactsService).onStart())
    .catch((e) => Logger.error(`Insights tables: ${(e as Error).stack ?? e}`, "Bootstrap"));
}

void bootstrap();
