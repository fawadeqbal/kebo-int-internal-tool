import { Module } from "@nestjs/common";
import { PartiesModule } from "../parties/parties.module";
import { HistoryController } from "./history.controller";
import { HistoryService } from "./history.service";

@Module({ imports: [PartiesModule], controllers: [HistoryController], providers: [HistoryService] })
export class HistoryModule {}
