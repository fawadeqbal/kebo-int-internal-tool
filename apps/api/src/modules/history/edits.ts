import { Body, Controller, Get, HttpCode, Injectable, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { can, editCardLabel, newNames } from "@kebo/shared";
import { DomainError, ForbiddenError, NotFoundError } from "@kebo/utils";
import { isSupplier } from "@kebo/database";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, SignedIn } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { inquiryAccess } from "../inquiries/inquiries.service";
import { orderAccess } from "../../common/auth/order-access";
import { savedHistory } from "../../common/names/old-names";

/** The records whose cards count their edits (their history shows them too). */
const EDIT_TYPES = ["inquiry", "factory_quote", "quotation", "order", "customer", "factory"] as const;
type EditType = (typeof EDIT_TYPES)[number];

export const editInput = z.object({
  type: z.enum(EDIT_TYPES),
  id: z.uuid("Unknown record"),
  /** The card on the record ("items", "lines.packing", "shipment"…). */
  card: z.string().trim().min(1).max(60),
  /** first: the card's first save (no reason); edit: a change to what was saved (with its reason). */
  kind: z.enum(["first", "edit"]),
  reason: z.string().trim().max(500).optional(),
  /** What changed, one sentence each ("2 Dust collector · target price 15,000 → 16,500"). */
  changes: z.array(z.string().trim().max(300)).max(300).default([]),
  /** The lines (or fields) changed, so each can say "edited 2×". */
  keys: z.array(z.string().trim().max(80)).max(1000).default([]),
  /** What changed on each line (or field), by its key: its own history ("Qty 2 → 3"). */
  lines: z.record(z.string().trim().max(80), z.array(z.string().trim().max(300)).max(20)).optional(),
});
export type EditInput = z.infer<typeof editInput>;
const editQuery = z.object({ type: z.enum(EDIT_TYPES), id: z.uuid("Unknown record") });

const FIRST = "card.first";
const EDIT = "card.edit";

/**
 * Every card counts the times what was saved on it was changed (board "Lines: view first, edit on purpose"):
 * one Save changes after the first save is one edit, with its reason and what changed. Kept in the audit log,
 * so the record's History shows each edit too.
 */
@Injectable()
export class EditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The record must be one this person sees. */
  private async check(user: SessionUser, type: EditType, id: string) {
    const db = this.prisma.db;
    const found =
      type === "inquiry"
        ? await db.inquiry.findFirst({ where: { id, deletedAt: null, ...inquiryAccess(user) }, select: { id: true } })
        : type === "factory_quote"
          ? can(user, "sourcing.manage")
            ? await db.supplierQuote.findFirst({ where: { id, inquiry: { deletedAt: null, ...inquiryAccess(user) } }, select: { id: true } })
            : null
          : type === "quotation"
            ? await db.quotationRevision.findFirst({ where: { id, quotation: { inquiry: { deletedAt: null, ...inquiryAccess(user) } } }, select: { id: true } })
            : type === "order"
              ? await db.order.findFirst({ where: { id, ...orderAccess(user) }, select: { id: true } })
              : type === "factory"
                ? can(user, "sourcing.manage")
                  ? await db.party.findFirst({ where: { id, ...isSupplier }, select: { id: true } })
                  : null
                : await db.party.findFirst({ where: { id }, select: { id: true } });
    if (!found) {
      if ((type === "factory_quote" || type === "factory") && !can(user, "sourcing.manage")) throw new ForbiddenError("You cannot see supplier prices.");
      throw new NotFoundError("Record");
    }
  }

  async record(user: SessionUser, input: EditInput) {
    await this.check(user, input.type, input.id);
    if (input.kind === "edit" && !input.reason) throw new DomainError("Say why you are changing what was saved.");
    return this.prisma.tx(async (tx) => {
      const n =
        input.kind === "edit"
          ? (await tx.auditLog.count({ where: { entityType: input.type, entityId: input.id, action: EDIT, newValues: { path: ["card"], equals: input.card } } })) + 1
          : 0;
      await this.audit.record(tx, {
        userId: user.id,
        action: input.kind === "edit" ? EDIT : FIRST,
        entityType: input.type,
        entityId: input.id,
        // "Lines from the supplier edited (edit 2): 1 · Received 1 → 2, and 3 more"
        summary:
          input.kind === "edit"
            ? `${editCardLabel(input.card)} edited (edit ${n})${input.changes.length ? `: ${input.changes[0]}${input.changes.length > 1 ? `, and ${input.changes.length - 1} more` : ""}` : ""}`
            : `${editCardLabel(input.card)} first saved`,
        newValues: { card: input.card, n, changes: input.changes, keys: input.keys, ...(input.lines ? { lines: input.lines } : {}) },
        reason: input.reason,
      });
      return { card: input.card, n };
    });
  }

  /** Each card of the record: how often it was edited, the last edit, every edit (newest first), and how often each line was. */
  async of(user: SessionUser, type: EditType, id: string) {
    await this.check(user, type, id);
    const rows = (
      await this.prisma.db.auditLog.findMany({
      where: { entityType: type, entityId: id, action: { in: [FIRST, EDIT] } },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, name: true } } },
    })
    ).map(savedHistory);
    const cards: Record<
      string,
      {
        count: number;
        first: { by: string | null; at: string } | null;
        edits: { n: number; by: string | null; at: string; reason: string | null; changes: string[]; keys: string[]; lines: Record<string, string[]> }[];
        keys: Record<string, number>;
      }
    > = {};
    for (const r of rows) {
      const v = (r.newValues ?? {}) as { card?: string; n?: number; changes?: string[]; keys?: string[]; lines?: Record<string, string[]> };
      if (!v.card) continue;
      const c = (cards[v.card] ??= { count: 0, first: null, edits: [], keys: {} });
      if (r.action === FIRST) {
        c.first = { by: r.user?.name ?? null, at: r.createdAt.toISOString() };
        continue;
      }
      c.count += 1;
      // Field names saved before "factory" became "supplier" are read as today's.
      const keys = newNames(v.keys ?? []);
      const lines = Object.fromEntries(Object.entries(v.lines ?? {}).map(([line, fields]) => [line, newNames(fields)]));
      c.edits.push({ n: v.n ?? c.count, by: r.user?.name ?? null, at: r.createdAt.toISOString(), reason: r.reason, changes: v.changes ?? [], keys, lines });
      for (const k of keys) c.keys[k] = (c.keys[k] ?? 0) + 1;
    }
    return { cards };
  }
}

@ApiTags("history")
@Controller("edits")
export class EditsController {
  constructor(private readonly edits: EditsService) {}

  /** ?type=&id= — each card's edits: count, who, when, why and what. */
  @SignedIn("checked inside: sourcing.manage")
  @Get()
  list(@CurrentUser() user: SessionUser, @Query(Validate(editQuery)) q: z.infer<typeof editQuery>) {
    return this.edits.of(user, q.type, q.id);
  }

  /** One Save changes on a card: its first save, or an edit with the reason. */
  @SignedIn("checked inside: sourcing.manage")
  @Post()
  @HttpCode(201)
  record(@CurrentUser() user: SessionUser, @Body(Validate(editInput)) body: EditInput) {
    return this.edits.record(user, body);
  }
}
