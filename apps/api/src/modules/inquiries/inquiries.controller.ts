import { Body, Controller, Delete, Get, Header, HttpCode, Options, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { z } from "zod";
import { assignInput, holdInput, inquiryInput, inquiryListQuery, noteInput, stageMoveInput, type InquiryInput, type InquiryListQuery, type StageMoveInput } from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, Public, RequirePermissions } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { InquiriesService } from "./inquiries.service";
import { normalizeFields, websiteInquiry, WebsiteService } from "./website.service";

const MAX_UPLOAD = 200 * 1024 * 1024; // hard ceiling; the configured limit is checked in the service

@ApiTags("inquiries")
@Controller("inquiries")
export class InquiriesController {
  constructor(private readonly inquiries: InquiriesService) {}

  /** ?stage=open|overdue|on_hold|new|sourcing|quoted|won|lost&assignee=me|unassigned|<id>&q&customerId&priority&channel&sort&page */
  @Get()
  list(@CurrentUser() user: SessionUser, @Query(Validate(inquiryListQuery)) q: InquiryListQuery) {
    return this.inquiries.list(user, q);
  }

  @Get(":id")
  get(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.inquiries.get(user, id);
  }

  @Post()
  @RequirePermissions("inquiries.create")
  create(@CurrentUser() user: SessionUser, @Body(Validate(inquiryInput)) body: InquiryInput) {
    return this.inquiries.create(user, body);
  }

  @Put(":id")
  update(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(inquiryInput)) body: InquiryInput) {
    return this.inquiries.update(user, id, body);
  }

  /** { to, lostReason?, note? } — mark lost, start working, or reopen. */
  @Post(":id/stage")
  @HttpCode(200)
  move(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(stageMoveInput)) body: StageMoveInput) {
    return this.inquiries.move(user, id, body);
  }

  @Post(":id/hold")
  @HttpCode(200)
  hold(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(holdInput)) body: z.infer<typeof holdInput>) {
    return this.inquiries.hold(user, id, body);
  }

  @Post(":id/assign")
  @HttpCode(200)
  assign(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(assignInput)) body: z.infer<typeof assignInput>) {
    return this.inquiries.assign(user, id, body.assigneeId);
  }

  @Post(":id/notes")
  note(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(noteInput)) body: z.infer<typeof noteInput>) {
    return this.inquiries.addNote(user, id, body.body);
  }

  @Delete(":id")
  @HttpCode(200)
  @RequirePermissions("inquiries.delete")
  async remove(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.inquiries.remove(user, id);
    return { ok: true };
  }

  /** multipart/form-data: file, and optionally milestoneId / factoryQuoteId / paymentId to tie it to a step. */
  @Post(":id/files")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD, files: 1 } }))
  upload(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(Validate(z.object({ milestoneId: z.uuid().optional(), factoryQuoteId: z.uuid().optional(), paymentId: z.uuid().optional() }))) links: { milestoneId?: string; factoryQuoteId?: string; paymentId?: string },
  ) {
    if (!file) throw new z.ZodError([{ code: "custom", path: ["file"], message: "Choose a file to upload", input: undefined }]);
    return this.inquiries.upload(user, id, file, links);
  }
}

@ApiTags("files")
@Controller("files")
export class FilesController {
  constructor(private readonly inquiries: InquiriesService) {}

  @Get(":id")
  async download(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const f = await this.inquiries.download(user, id);
    res.set({
      "Content-Type": f.mimeType,
      "Content-Length": String(f.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    });
    return new StreamableFile(f.stream);
  }

  @Delete(":id")
  @HttpCode(200)
  async remove(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.inquiries.removeFile(user, id);
    return { ok: true };
  }
}

/**
 * Public endpoint for the RFQ form on the company website (JSON or form post).
 * Protected by allowed origins, a honeypot field, Turnstile (when configured) and rate limits.
 */
@ApiTags("public")
@Controller("public/inquiries")
export class WebsiteController {
  constructor(private readonly website: WebsiteService) {}

  private origins() {
    return (process.env.PUBLIC_FORM_ORIGINS ?? "https://keboint.com,https://www.keboint.com").split(",").map((o) => o.trim().replace(/\/$/, "")).filter(Boolean);
  }

  private cors(req: Request, res: Response) {
    const origin = req.headers.origin;
    if (origin && this.origins().includes(origin)) res.set("Access-Control-Allow-Origin", origin);
    res.set({ "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Accept", "Access-Control-Max-Age": "86400", Vary: "Origin" });
    return origin;
  }

  @Public()
  @Options()
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  preflight(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.cors(req, res);
  }

  @Public()
  @Post()
  async receive(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() raw: Record<string, unknown>) {
    const origin = this.cors(req, res);
    if (origin && !this.origins().includes(origin)) {
      res.status(403);
      return { ok: false, message: "This website is not allowed to send inquiries." };
    }
    const ip = req.ip ?? "local";
    this.website.limit(`inquiry:${ip}`, 5, 10 * 60_000);
    const fields = normalizeFields(raw ?? {});
    // Bots fill every field, including the hidden one: pretend it worked and drop it.
    if (fields.honeypot) return { ok: true, message: "Thank you." };
    const input = websiteInquiry.parse(fields);
    if (!(await this.website.human(raw?.["cf-turnstile-response"] ?? raw?.turnstileToken, ip))) {
      res.status(403);
      return { ok: false, message: "We could not confirm you are not a robot. Please reload the page and try again, or contact us on WhatsApp." };
    }
    this.website.limit("inquiry:all", Number(process.env.PUBLIC_INQUIRIES_PER_HOUR) || 40, 60 * 60_000);
    const { reference } = await this.website.receive(input);
    res.status(201);
    return { ok: true, reference, message: `Thank you. We have your request (ref. ${reference}). Our sourcing team will reply within one working day.` };
  }
}
