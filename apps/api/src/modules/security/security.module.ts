import { Module } from "@nestjs/common";
import { MySecurityController, RolesController, SecurityController } from "./security.controller";
import { SecurityService } from "./security.service";

@Module({ controllers: [RolesController, SecurityController, MySecurityController], providers: [SecurityService] })
export class SecurityModule {}
