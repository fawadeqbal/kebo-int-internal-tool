import { Module } from "@nestjs/common";
import { PartiesModule } from "../parties/parties.module";
import { HistoryController } from "./history.controller";
import { HistoryService } from "./history.service";
import { EditsController, EditsService } from "./edits";

@Module({ imports: [PartiesModule], controllers: [HistoryController, EditsController], providers: [HistoryService, EditsService] })
export class HistoryModule {}
