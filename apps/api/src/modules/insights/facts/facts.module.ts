import { Module } from "@nestjs/common";
import { FactsService } from "./facts.service";
import { FactsReadService } from "./facts-read.service";
import { FactsController } from "./facts.controller";

@Module({ controllers: [FactsController], providers: [FactsService, FactsReadService], exports: [FactsService, FactsReadService] })
export class FactsModule {}
