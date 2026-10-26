import { Global, Module } from "@nestjs/common";
import { loadServerEnv, type ServerEnv } from "@kebo/config";

/** Injection token for the validated environment (fails at start-up, listing every problem). */
export const ENV = Symbol("ENV");
export type Env = Readonly<ServerEnv>;

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => loadServerEnv() }],
  exports: [ENV],
})
export class EnvModule {}
