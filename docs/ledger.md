# The ledger (Finance › Ledger)

Every money record, posted from its document. Nobody types an accounting entry: saving, changing, approving or
removing a document writes its ledger rows in the same database transaction. Rows are never changed or deleted.

- **A change** is a correction: the rows posted before are reversed (each reversal row points at the row it undoes
  and carries the person's reason) and the new rows are posted. For an **order** and **what we owe a factory on it**
  the correction is the difference only (an order total 34,639.60 → 35,000.00 posts 360.40).
- **A removal** (a payment voided, an order cancelled) is a reversal on the day it was removed, with the reason, and
  stays visible ("removed").
- Posting is **idempotent**: the posting service works out the rows each document should have now, compares them
  with what is posted for it, and writes only the difference. Calling it again writes nothing.

Code: `apps/api/src/modules/ledger/` — `rules.ts` (what each document posts, pure), `posting.service.ts` (compare and
write; every write path calls `LedgerPosting.post(tx, refs, { userId, reason })`), `check.ts` (the check),
`ledger.service.ts` (the read API, the nightly run), `apps/api/src/cli/ledger.ts` (the command line).
Shared names: `packages/shared/src/workflows/ledger.ts`. Tests: `apps/api/test/ledger.test.ts`,
`apps/api/test/ledger-write-paths.test.ts` (fails when a money write path does not post).

## The table

`ledger_entries` (company table: `company_id` from the connection, row-level security, every link kept inside the
company). One row per account touched; the rows of one posting share `group_id` and `entry_no` (numbered per company)
and their debits equal their credits in the main currency.

| column                                                                 |                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entry_no`, `group_id`, `line`                                         | the posting, and the row's place in it                                                                                                                                                                                      |
| `posted_at`, `date`                                                    | when it was written; the day it counts on (the document's day; a correction's: the day it was made)                                                                                                                         |
| `type`                                                                 | `order` · `purchase_order` · `money_in` · `money_out` · `transfer` · `expense` · `credit` · `correction` · `opening` · `fx`                                                                                                 |
| `source_type`, `source_id`, `part`                                     | the document (`order`, `purchase_order` = `orderId:factoryId`, `payment`, `receipt`, `credit`, `factory_payment`, `expense`, `transfer`, `account`, `fx_order`, `fx_factory`); `part` = `repaid` for an expense's repayment |
| `ref`                                                                  | the document's number: SO-…, PO-… (or "SO-… · factory" before a purchase-order paper exists), RC-…-n, FP-…-n, EX-…, TR-…, CR-…                                                                                              |
| `order_id`, `customer_id`, `factory_id`, `user_id`, `money_account_id` | what it is about                                                                                                                                                                                                            |
| `account`                                                              | the fixed account key (below)                                                                                                                                                                                               |
| `debit`, `credit`, `currency`, `rate`, `debit_base`, `credit_base`     | in the entry's currency; its rate (units per one of the main currency); in the main currency                                                                                                                                |
| `memo`, `reverses_id`, `reason`, `created_by`                          |                                                                                                                                                                                                                             |

**Append-only.** A trigger refuses `UPDATE`, `DELETE` and `TRUNCATE` on the company connection (`kebo_app`), unless the
transaction says `SET LOCAL kebo.ledger_rewrite = 'on'` — only `ledger rebuild --reset` does. The owner's connection
(the platform clearing a whole company) is not stopped.

`ledger_state`: whether a company's ledger has been posted from its records (`built_at`), and the last check.

## The accounts (fixed)

| key                   |                                                                            |
| --------------------- | -------------------------------------------------------------------------- |
| `money:<accountId>`   | each bank, cash and wallet account (MoneyAccount)                          |
| `money:none:<CUR>`    | money not put on an account, one per currency (as the cash book counts it) |
| `customer:<id>`       | what a customer owes us, per order (`order_id`)                            |
| `credit:<customerId>` | the customer's credit we hold                                              |
| `factory:<id>`        | what we owe a factory, per order (`order_id`) and currency                 |
| `staff:<userId>`      | what we owe a person back (expenses from their own money)                  |
| `sales`, `goods_cost` | from orders and what we owe factories for them                             |
| `expense:<category>`  | one per expense category                                                   |
| `bank_charges`        | taken by banks from customers' payments                                    |
| `fx_diff`             | exchange differences                                                       |
| `expenses_recovered`  | expenses charged to a customer or borne by a factory                       |
| `opening`             | money accounts' opening balances                                           |

## What each document posts

| document                                            | debit                                                     | credit                                                                          | when                                                                 |
| --------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| order (confirmed)                                   | customer (order total)                                    | sales                                                                           | ordered on; cancelling reverses it                                   |
| a factory's part of an order                        | goods cost                                                | factory (`factoryPosition` owed, with tax), per currency                        | ordered on; the difference when lines change; cancelling reverses it |
| payment                                             | money account (what arrived, its currency) + bank charges | customer (amount + bank charges, order currency)                                | paid on                                                              |
| payment from credit                                 | customer credit                                           | customer                                                                        |                                                                      |
| one transfer over several orders                    | money account                                             | customer per order (+ bank charges), the rest to customer credit                | paid on                                                              |
| credit kept from a cancelled order                  | customer (that order)                                     | customer credit                                                                 |                                                                      |
| cancellation fee                                    | customer (that order)                                     | sales                                                                           |                                                                      |
| credit refunded                                     | customer credit                                           | money account                                                                   |                                                                      |
| factory payment                                     | factory (that order)                                      | money account                                                                   | paid on                                                              |
| expense                                             | expense kind                                              | money account, or staff (own money)                                             | spent on                                                             |
| … charged to the customer                           | customer (order currency)                                 | expenses recovered                                                              |                                                                      |
| … borne by a factory                                | factory (its currency)                                    | expenses recovered                                                              |                                                                      |
| … repaid to the person (`part` repaid)              | staff                                                     | money account                                                                   | repaid on                                                            |
| money lost to a factory when an order was cancelled | expense (other)                                           | factory                                                                         |                                                                      |
| transfer between accounts                           | money account (in)                                        | money account (out); a difference at Settings' rates → exchange difference      | transferred on                                                       |
| money account                                       | money account                                             | opening (the opening balance less anything posted on it before its opening day) | opening day                                                          |

Rates: the order's own rate for its amounts; a payment's own rate when it arrived in another currency; a factory
payment's own rate; an expense's own rate; Settings' rate (when posted) for what we owe a factory, transfers and
openings. A posting whose sides differ in the main currency (rates, rounding) gets an `fx_diff` line.

**Exchange difference.** When an order is settled with its customer in the order's currency (the balance is 0) but
its main-currency value is not 0, an `fx` posting takes the rest to `fx_diff`; the same for a factory's part of an
order in one currency. It is reversed if the balance opens again.

Waiting-for-approval money posts nothing: approving records it through the usual code, which posts.

## Starting the ledger, and rebuilding it

- **Automatic.** The API, when it starts, posts every record of each company whose ledger was never posted
  (`ledger_state.built_at` empty), one company at a time; the first read of the ledger does the same. So the first
  start after the migration posts everything, and a restore, a demo's sample data or a cleared company is posted again.
- **On deploy.** `deploy/ci-deploy.sh`, after the new containers are healthy, runs
  `ledger.js rebuild --all` (posts anything not posted as it stands: the first time everything, then nothing) and
  `ledger.js check --all`, and prints both in the deploy log. Neither fails the deploy.
- **By hand** (in Docker: `sudo docker compose exec -T api node apps/api/dist/cli/ledger.js …`):

  ```
  ledger.js rebuild --all --dry-run          what it would write, written nothing (one transaction, rolled back)
  ledger.js rebuild --all                    post every record not posted as it stands, in date order
  ledger.js rebuild --company <slug> --reset remove the company's rows and post everything again (rules changed)
  ledger.js check --all                      the ledger against today's figures; exits 1 on a difference
  ```

## The check

`ledger check` (also `GET /api/ledger/check`, and the worker every night) compares the ledger with today's figures
worked out the usual way: every order's balance with its customer (`orderPosition`: total + charged − settled),
every factory part's (`factoryPosition`: owed − paid − taken off), every money account's balance (the cash book),
what we owe each person back, each customer's credit; and that every posting's debits equal its credits.

Every night the worker first posts anything a save did not post (a missing hook, a plan change, data loaded by
hand), logging `ledger_catch_up` in the platform log when it had to, then runs the check; a difference is logged as
`ledger_mismatch` (Platform › Platform log) with the first 20 differences.

## The API (read only, `ledger.view`)

`ledger.view` is held by the Manager and Super Admin roles and every role that records payments or manages
expenses (granted by the migration).

- `GET /api/ledger/entries?from&to&type&account&customerId&factoryId&userId&orderId&currency&removed&lead&page&pageSize` —
  rows newest first with names (`accountLabel`, `with`, `order`, `counter`: the other side), `removed` (reversed: day
  and reason), totals of everything filtered (`debit`, `credit`, `balanced`) and per currency. `account=money:` (ending
  in `:`) is every account of a kind; `lead=true` one line per posting side ("Bank → customer").
- `GET /api/ledger/entries/:id` — a posting (by a row's id or its group id): its rows, totals, who posted it, what it
  reverses or was reversed by, the document's other postings, and the document (`source`: where it is, its file, who
  recorded and approved it, what it settles).
- `GET /api/ledger/parties/:kind/:id?from&to&onlyOpen&removed` — `kind` customer | factory | staff: opening and
  closing (per currency and in the main currency), every row with the running balance, the credit we hold
  (customers), and ageing.
- `GET /api/ledger/ageing?side=receivable|payable|staff` — each party's open amounts by how late: not due, 1–30,
  31–60, 61–90, 90+ days (from the plans' due dates; charges from the day spent; own money from the day paid).
- `GET /api/ledger/accounts?to` — every account's balance, grouped, and whether debits equal credits.
- `GET /api/ledger/check` — the check, now.

## Not in it (yet)

- No Suppliers party and no Purchase-orders module: what we owe a factory comes from each order's factory part.
- A change of plan (the expenses module switched on or off) changes what is charged to customers and borne by
  factories; the ledger follows at the nightly run. A change of Settings' exchange rates re-posts the expenses
  factories bear in another currency at once (that is how `factoryPosition` counts them).
- A month cannot be closed yet.
