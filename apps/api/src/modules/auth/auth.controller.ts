import { Body, Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { z } from "zod";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, Public } from "../../common/auth/decorators";
import { SESSION_COOKIE } from "../../common/auth/tokens.service";
import type { SessionUser } from "../../common/auth/session-user";
import { AuthService } from "./auth.service";

const loginInput = z.object({
  email: z.string().trim().min(1, "Enter your email"),
  password: z.string().min(1, "Enter your password"),
  /** Browsers get an httpOnly cookie as well as the token. */
  cookie: z.boolean().default(false),
});

/** The client's IP: the last X-Forwarded-For entry is the one our own proxy added, so it cannot be faked. */
const clientIp = (req: Request) => (req.headers["x-forwarded-for"] as string | undefined)?.split(",").at(-1)?.trim() || req.socket.remoteAddress || "local";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(@Body(Validate(loginInput)) body: z.infer<typeof loginInput>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(body.email, body.password, { ip: clientIp(req), userAgent: req.headers["user-agent"] });
    if (body.cookie) {
      res.cookie(SESSION_COOKIE, result.token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.COOKIE_SECURE === "true",
        path: "/",
        maxAge: result.expiresInSeconds * 1000,
      });
    }
    return result;
  }

  @Post("logout")
  @HttpCode(200)
  async logout(@CurrentUser() user: SessionUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  }

  @Get("me")
  me(@CurrentUser() user: SessionUser) {
    return this.auth.profile(user);
  }
}
