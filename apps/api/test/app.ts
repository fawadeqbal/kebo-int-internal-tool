import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { ENV, type Env } from "../src/config/env";
import { configureApp } from "../src/setup";

/**
 * Boots the real API against the database in DATABASE_URL (migrated and seeded
 * with --demo). Run: pnpm db:deploy && pnpm db:seed --demo && pnpm --filter @kebo/api test
 */
export async function startApp(): Promise<INestApplication> {
  process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-test-1234";
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication();
  configureApp(app, app.get<Env>(ENV));
  await app.init();
  return app;
}

export async function signIn(app: INestApplication, email: string, password = "Demo@12345") {
  const res = await request(app.getHttpServer()).post("/api/auth/login").send({ email, password }).expect(200);
  return res.body.token as string;
}

export const api = (app: INestApplication, token?: string) => {
  const server = app.getHttpServer();
  const auth = (r: request.Test) => (token ? r.set("authorization", `Bearer ${token}`) : r);
  return {
    get: (url: string) => auth(request(server).get(`/api${url}`)),
    post: (url: string, body?: object) => auth(request(server).post(`/api${url}`)).send(body ?? {}),
    patch: (url: string, body?: object) => auth(request(server).patch(`/api${url}`)).send(body ?? {}),
    put: (url: string, body?: object) => auth(request(server).put(`/api${url}`)).send(body ?? {}),
    delete: (url: string) => auth(request(server).delete(`/api${url}`)),
  };
};
