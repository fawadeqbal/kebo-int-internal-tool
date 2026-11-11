import { Module } from "@nestjs/common";
import { OperationsController } from "./operations.controller";
import { OperationsService } from "./operations.service";

/** Operations & trading lists across orders (read-only). */
@Module({ controllers: [OperationsController], providers: [OperationsService] })
export class OperationsModule {}
