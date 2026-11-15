import { Module } from "@nestjs/common";
import { MySecurityController, RolesController, SecurityController } from "./security.controller";
import { SecurityService } from "./security.service";
import { AccessMapModule } from "../../common/auth/access-map";

@Module({ imports: [AccessMapModule], controllers: [RolesController, SecurityController, MySecurityController], providers: [SecurityService] })
export class SecurityModule {}
