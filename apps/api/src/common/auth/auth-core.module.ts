import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard } from "./auth.guard";
import { TokensService } from "./tokens.service";
import { CompanyResolver } from "../company/company-resolver";

@Global()
@Module({
  providers: [TokensService, CompanyResolver, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [TokensService, CompanyResolver],
})
export class AuthCoreModule {}
