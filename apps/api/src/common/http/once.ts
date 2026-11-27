import { CallHandler, ExecutionContext, HttpException, HttpStatus, Injectable, NestInterceptor, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { from, lastValueFrom, type Observable } from "rxjs";
import { PrismaService } from "../../database/prisma.service";
import { withNewNames } from "@kebo/shared";

/**
 * One-time keys for money saves. A client sends `Idempotency-Key: <key>` with a save (the web's forms one per
 * form until it saves, the phone's waiting saves their step's id). The first request with a key does the save
 * and keeps its answer; a repeat (a double tap, a retry after the answer was lost, the phone sending its queue
 * again) does nothing and gets that first answer. A repeat that comes while the first still runs waits for it.
 * Without the header a save works as before (older phone apps). Keys are per person and kept 7 days.
 */
export const ONCE = "kebo:once";
/** A save that must not happen twice: with an Idempotency-Key, a repeat gets the first answer. */
export const Once = () => SetMetadata(ONCE, true);

export const ONCE_HEADER = "idempotency-key";
export const ONCE_KEY = /^[A-Za-z0-9_-]{8,100}$/;
/** How long a repeat waits for the first one's answer. */
const WAIT_MS = 8_000;
/** A first one with no answer after this long stopped half-way (the server restarted). */
const LOST_MS = 120_000;
const KEEP_DAYS = 7;

type Row = { action: string; fingerprint: string; answer: unknown; answered_at: Date | null; created_at: Date };

@Injectable()
export class OnceInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.reflector.get<boolean>(ONCE, ctx.getHandler())) return next.handle();
    const req = ctx.switchToHttp().getRequest<Request & { user?: { id: string } }>();
    const key = req.header(ONCE_HEADER)?.trim();
    if (!key || !req.user) return next.handle();
    const res = ctx.switchToHttp().getResponse<Response>();
    return from(this.once(req.user.id, key, req, res, () => lastValueFrom(next.handle(), { defaultValue: undefined })));
  }

  async once(userId: string, key: string, req: Request, res: Response, run: () => Promise<unknown>): Promise<unknown> {
    if (!ONCE_KEY.test(key)) throw new HttpException({ message: "This save's one-time key is not valid. Reload and try again." }, HttpStatus.BAD_REQUEST);
    const db = this.prisma.db;
    const action = `${req.method} ${(req.originalUrl ?? req.url).split("?")[0]}`.slice(0, 200);
    // The body as it arrived: an old phone app's names are read as new ones on the way in, and a save it
    // repeats must look the same as the first time it was sent.
    const sent = (req as Request & { bodyAsSent?: unknown }).bodyAsSent ?? req.body;
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(sent ?? null))
      .digest("hex");
    const until = Date.now() + WAIT_MS;
    for (;;) {
      const claimed = await db.$executeRaw`
        insert into request_keys (user_id, key, action, fingerprint) values (${userId}::uuid, ${key}, ${action}, ${fingerprint})
        on conflict do nothing`;
      if (claimed === 1) break;
      const [row] = await db.$queryRaw<Row[]>`
        select action, fingerprint, answer, answered_at, created_at from request_keys where user_id = ${userId}::uuid and key = ${key}`;
      // The first one failed meanwhile and let the key go: this one does the save.
      if (!row && Date.now() <= until) continue;
      if (!row) throw new HttpException({ message: "This is still being saved. Wait a moment, then reload to see it." }, HttpStatus.CONFLICT);
      if (row.action !== action || row.fingerprint !== fingerprint) {
        throw new HttpException(
          { message: "This was already saved with other details. Close the window and check the list before saving again." },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (row.answered_at) {
        res.setHeader("Idempotent-Replayed", "true");
        // An answer remembered before "factory" became "supplier" is given with today's names.
        return withNewNames(row.answer) ?? undefined;
      }
      if (Date.now() - row.created_at.getTime() > LOST_MS) {
        throw new HttpException({ message: "We could not confirm that this went through. Check the list before saving it again." }, HttpStatus.CONFLICT);
      }
      if (Date.now() > until) {
        throw new HttpException({ message: "This is still being saved. Wait a moment, then reload to see it." }, HttpStatus.CONFLICT);
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    let answer: unknown;
    try {
      answer = await run();
    } catch (e) {
      // Not saved: the key is free again, for the same save sent once more (after "Why?", or a fix).
      await db.$executeRaw`delete from request_keys where user_id = ${userId}::uuid and key = ${key}`.catch(() => undefined);
      throw e;
    }
    // Kept as the client received it (JSON).
    const kept = answer === undefined ? null : (JSON.parse(JSON.stringify(answer)) as unknown);
    await db.$executeRaw`
      update request_keys set answer = ${JSON.stringify(kept)}::jsonb, answered_at = now() where user_id = ${userId}::uuid and key = ${key}`;
    await db.$executeRaw`
      delete from request_keys where user_id = ${userId}::uuid and created_at < now() - make_interval(days => ${KEEP_DAYS}::int)`;
    return answer;
  }
}
