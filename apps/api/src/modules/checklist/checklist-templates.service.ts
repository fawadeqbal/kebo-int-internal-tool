import { Injectable } from "@nestjs/common";
import type { Prisma } from "@kebo/database";
import { AUTO_ITEMS, can, checklistPaperOf, FLOW_STEPS, HIDEABLE_AUTO_KEYS, type ChecklistTemplateInput } from "@kebo/shared";
import { ForbiddenError } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import type { SessionUser } from "../../common/auth/session-user";
import { CHECKLIST_SETTING, ChecklistService } from "./checklist.service";

/**
 * The company's own checklist (Settings › Order checklist): the items every new
 * order starts with, per step, and the automatic items it hides. Saved as a
 * whole; orders that already have their checklist keep it.
 */
@Injectable()
export class ChecklistTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly checklist: ChecklistService,
  ) {}

  private must(user: SessionUser) {
    if (!can(user, "settings.manage")) throw new ForbiddenError("You cannot change the company settings.");
  }

  async get(user: SessionUser) {
    this.must(user);
    const [choices, items] = await Promise.all([this.checklist.companyChoices(), this.checklist.companyList()]);
    return {
      saved: choices.saved,
      hidden: choices.hidden,
      items: items.map((i) => ({
        step: i.step,
        title: i.title,
        tool: i.tool,
        fields: i.fields ?? [],
        paper: i.paper ?? null,
        route: i.route ?? null,
        dueDays: i.dueDays ?? null,
      })),
      /** The automatic items per step, each with whether the company hides it. */
      auto: FLOW_STEPS.map((step) => ({
        step,
        items: AUTO_ITEMS[step]
          .filter((d) => HIDEABLE_AUTO_KEYS.includes(d.key))
          .map((d) => ({ key: d.key, title: d.title, hidden: choices.hidden.includes(d.key) })),
      })),
    };
  }

  async save(user: SessionUser, input: ChecklistTemplateInput) {
    this.must(user);
    await this.prisma.tx(async (tx) => {
      const before = await tx.checklistTemplate.count();
      await tx.checklistTemplate.deleteMany({});
      const seen = new Map<string, number>();
      await tx.checklistTemplate.createMany({
        data: input.items.map((i) => {
          const n = seen.get(i.step) ?? 0;
          seen.set(i.step, n + 1);
          return {
            step: i.step,
            title: i.title,
            tool: i.tool,
            fields: i.fields as unknown as Prisma.InputJsonValue,
            paper: checklistPaperOf(i.tool, i.paper),
            route: i.route,
            dueDays: i.dueDays,
            sortOrder: n * 10 + 5,
          };
        }),
      });
      const value = { hidden: [...new Set(input.hidden)], saved: true };
      await tx.setting.upsert({
        where: { companyId_key: { companyId: user.companyId, key: CHECKLIST_SETTING } },
        create: { key: CHECKLIST_SETTING, value },
        update: { value },
      });
      await this.audit.record(tx, {
        userId: user.id,
        action: "update",
        entityType: "settings",
        summary: `Changed the order checklist (${input.items.length} item${input.items.length === 1 ? "" : "s"}${value.hidden.length ? `, ${value.hidden.length} automatic hidden` : ""})`,
        oldValues: { items: before },
        newValues: { items: input.items.length, hidden: value.hidden },
      });
    });
    return this.get(user);
  }
}
