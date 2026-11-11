import { Module } from "@nestjs/common";
import { TreasuryService } from "./treasury.service";
import { TreasuryController } from "./treasury.controller";

/** Treasury: every payment in and out (Treasury › Payments). Reads the money records; recording stays with them for now. */
@Module({ controllers: [TreasuryController], providers: [TreasuryService], exports: [TreasuryService] })
export class TreasuryModule {}
