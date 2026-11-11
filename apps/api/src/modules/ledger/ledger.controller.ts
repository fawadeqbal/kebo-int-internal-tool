import { Body, Controller, Get, Param, ParseEnumPipe, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { CURRENCIES, isoDate, LEDGER_ENTRY_TYPES, LEDGER_PARTY_KINDS, type LedgerPartyKind } from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { RequirePermissions } from "../../common/auth/decorators";
import { LedgerService } from "./ledger.service";

const day = isoDate();
const flag = (fallback: boolean) =>
  z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === "true"));

const entriesQuery = z.object({
  from: day.optional(),
  to: day.optional(),
  type: z.enum(LEDGER_ENTRY_TYPES).optional(),
  account: z.string().trim().max(80).optional(),
  customerId: z.uuid().optional(),
  factoryId: z.uuid().optional(),
  userId: z.uuid().optional(),
  orderId: z.uuid().optional(),
  currency: z.enum(CURRENCIES).optional(),
  removed: flag(true),
  lead: flag(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

const partyQuery = z.object({ from: day.optional(), to: day.optional(), onlyOpen: flag(false), removed: flag(false) });
const statementQuery = z.object({
  from: day.optional(),
  to: day.optional(),
  currency: z.enum(CURRENCIES).optional(),
  no: z.coerce.number().int().min(1).max(99999).optional(),
});
const issueInput = z.object({ year: z.coerce.number().int().min(2000).max(2100) });
const ageingQuery = z.object({ side: z.enum(["receivable", "payable", "staff"]).default("receivable") });
const accountsQuery = z.object({ to: day.optional() });

/**
 * Finance › Ledger (read only; ledger.view). Rows are posted by the documents themselves (LedgerPosting), never here.
 */
@ApiTags("ledger")
@Controller("ledger")
@RequirePermissions("ledger.view")
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  /**
   * ?from&to&type&account&customerId&factoryId&userId&orderId&currency&removed&lead&page&pageSize →
   * { mainCurrency, rows: [{ id, entryNo, groupId, date, type, typeLabel, source, ref, account, accountLabel, side, counter,
   *   debit, credit, currency, rate, debitBase, creditBase, with, order, memo, reason, removed, correction }], total, page,
   *   pageSize, totals: { debit, credit, balanced, entries }, byCurrency }
   */
  @Get("entries")
  entries(@Query(Validate(entriesQuery)) q: z.infer<typeof entriesQuery>) {
    return this.ledger.entries(q);
  }

  /** One posting (by a row's id or the posting's group id): its rows, what it settles, its document and file, corrections. */
  @Get("entries/:id")
  entry(@Param("id", ParseUUIDPipe) id: string) {
    return this.ledger.entry(id);
  }

  /** A customer's, factory's or person's ledger: opening, rows with the running balance, closing, ageing. */
  @Get("parties/:kind/:id")
  party(
    @Param("kind", new ParseEnumPipe(LEDGER_PARTY_KINDS)) kind: LedgerPartyKind,
    @Param("id", ParseUUIDPipe) id: string,
    @Query(Validate(partyQuery)) q: z.infer<typeof partyQuery>,
  ) {
    return this.ledger.party(kind, id, q);
  }

  /**
   * A party's statement of account as a paper (KeboDoc): ?from&to&currency&no (no: an issued number; without it, a
   * preview marked "Draft") → { doc, party, from, to, currency, currencies, issued, share: { fileName, message } }.
   */
  @Get("parties/:kind/:id/statement")
  statement(
    @Param("kind", new ParseEnumPipe(LEDGER_PARTY_KINDS)) kind: LedgerPartyKind,
    @Param("id", ParseUUIDPipe) id: string,
    @Query(Validate(statementQuery)) q: z.infer<typeof statementQuery>,
  ) {
    return this.ledger.statement(kind, id, q);
  }

  /** { year } → the next statement number for the party in that year: { no, number } (ST-F-2026-0012). */
  @Post("parties/:kind/:id/statement")
  issue(
    @Param("kind", new ParseEnumPipe(LEDGER_PARTY_KINDS)) kind: LedgerPartyKind,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(issueInput)) input: z.infer<typeof issueInput>,
  ) {
    return this.ledger.issueStatement(kind, id, input.year);
  }

  /** ?side=receivable|payable|staff → each party's open amounts by how late (not due, 1–30, 31–60, 61–90, 90+). */
  @Get("ageing")
  ageing(@Query(Validate(ageingQuery)) q: z.infer<typeof ageingQuery>) {
    return this.ledger.ageing(q.side);
  }

  /** Every account's balance, grouped (Money, Customers, Factories, Staff, Sales…), and whether debits equal credits. */
  @Get("accounts")
  accounts(@Query(Validate(accountsQuery)) q: z.infer<typeof accountsQuery>) {
    return this.ledger.accounts(q);
  }

  /** The ledger against today's figures, now: every difference (kept as the last check). */
  @Get("check")
  check() {
    return this.ledger.check();
  }
}
