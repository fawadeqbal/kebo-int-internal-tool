import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ENV, type Env } from "./config/env";
import { configureApp } from "./setup";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const env = app.get<Env>(ENV);
  configureApp(app, env);
  await app.listen(env.API_PORT);
  Logger.log(`API on http://localhost:${env.API_PORT}/api (docs at /api/docs)`, "Bootstrap");
}

void bootstrap();
