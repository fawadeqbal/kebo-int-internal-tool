import { Module } from "@nestjs/common";
import { MoneyModule } from "../money/money.module";
import { ChecklistController, ChecklistTemplatesController } from "./checklist.controller";
import { ChecklistService } from "./checklist.service";
import { ChecklistTemplatesService } from "./checklist-templates.service";

/** Order flow v3: each order's checklist under its six steps, and the company's own list (see @kebo/shared workflows/checklist). */
@Module({
  imports: [MoneyModule],
  controllers: [ChecklistTemplatesController, ChecklistController],
  providers: [ChecklistService, ChecklistTemplatesService],
  exports: [ChecklistService],
})
export class ChecklistModule {}
