import { Module } from "@nestjs/common";
import { InquiriesModule } from "../inquiries/inquiries.module";
import { SourcingService } from "./sourcing.service";
import { SourcingController } from "./sourcing.controller";

@Module({ imports: [InquiriesModule], controllers: [SourcingController], providers: [SourcingService], exports: [SourcingService] })
export class SourcingModule {}
