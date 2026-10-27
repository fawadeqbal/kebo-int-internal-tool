import { Body, Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { z } from "zod";
import { Validate } from "../../common/http/zod.pipe";
import { AllowDuringTwoStepSetup, CurrentUser, Public } from "../../common/auth/decorators";
import { SESSION_COOKIE, sessionCookieOptions, tokenFrom } from "../../common/auth/tokens.service";
import type { SessionUser } from "../../common/auth/session-user";
import { AuthService } from "./auth.service";

const loginInput = z.object({
  email: z.string().trim().min(1, "Enter your email"),
  password: z.string().min(1, "Enter your password"),
  /** Browsers get an httpOnly cookie as well as the token. */
  cookie: z.boolean().default(false),
});

/** The client's IP. Express reads X-Forwarded-For only when TRUST_PROXY says a proxy is in front, so it cannot be faked. */
const clientIp = (req: Request) => req.ip || req.socket.remoteAddress || "local";

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
      res.cookie(SESSION_COOKIE, result.token, sessionCookieOptions());
    }
    return result;
  }

  /** { code } with the token from login (header or cookie): finishes a two-step sign-in. */
  @Public()
  @Post("two-step")
  @HttpCode(200)
  twoStep(
    @Body(Validate(z.object({ code: z.string().trim().min(6, "Enter the code").max(20) }))) body: { code: string },
    @Req() req: Request,
  ) {
    return this.auth.completeTwoStep(tokenFrom(req.headers), body.code, { ip: clientIp(req), userAgent: req.headers["user-agent"] });
  }

  @AllowDuringTwoStepSetup()
  @Post("logout")
  @HttpCode(200)
  async logout(@CurrentUser() user: SessionUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  }

  @AllowDuringTwoStepSetup()
  @Get("me")
  me(@CurrentUser() user: SessionUser) {
    return this.auth.profile(user);
  }
}
