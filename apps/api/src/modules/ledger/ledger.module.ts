import { Module } from "@nestjs/common";
import { LedgerService } from "./ledger.service";
import { LedgerController } from "./ledger.controller";

/** The ledger's reading side and its jobs (the worker's nightly run, the API's start, the CLI). */
@Module({ providers: [LedgerService], exports: [LedgerService] })
export class LedgerJobsModule {}

@Module({ imports: [LedgerJobsModule], controllers: [LedgerController] })
export class LedgerModule {}
