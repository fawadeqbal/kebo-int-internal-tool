import { Module } from "@nestjs/common";
import { CustomersService } from "./customers.service";
import { SuppliersService } from "./suppliers.service";
import { CustomersController } from "./customers.controller";
import { SuppliersController } from "./suppliers.controller";

@Module({ controllers: [CustomersController, SuppliersController], providers: [CustomersService, SuppliersService], exports: [CustomersService, SuppliersService] })
export class PartiesModule {}
