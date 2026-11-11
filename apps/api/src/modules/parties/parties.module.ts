import { Module } from "@nestjs/common";
import { CustomersService } from "./customers.service";
import { FactoriesService } from "./factories.service";
import { CustomersController } from "./customers.controller";
import { FactoriesController } from "./factories.controller";

@Module({ controllers: [CustomersController, FactoriesController], providers: [CustomersService, FactoriesService], exports: [CustomersService, FactoriesService] })
export class PartiesModule {}
