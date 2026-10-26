import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard } from "./auth.guard";
import { TokensService } from "./tokens.service";

@Global()
@Module({
  providers: [TokensService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [TokensService],
})
export class AuthCoreModule {}
