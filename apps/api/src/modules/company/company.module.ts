import { Module } from "@nestjs/common";
import { SettingsModule } from "../settings/settings.module";
import { CompanyController } from "./company.controller";

@Module({ imports: [SettingsModule], controllers: [CompanyController] })
export class CompanyModule {}
