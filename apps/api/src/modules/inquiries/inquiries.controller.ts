import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Options,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  assignInput,
  attachmentInput,
  holdInput,
  inquiryInput,
  inquiryListQuery,
  noteInput,
  splitItemInput,
  stageMoveInput,
  type AttachmentInput,
  type InquiryInput,
  type InquiryListQuery,
  type SplitItemInput,
  type StageMoveInput,
} from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, Public, RequirePermissions } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { CompanyContext } from "../../common/company/company-context";
import { companyRefusal } from "../../common/auth/auth.guard";
import { LimitsService } from "../../common/company/limits.service";
import { CompaniesService } from "../../common/company/companies.service";
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
  hold(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(holdInput)) body: z.infer<typeof holdInput>,
  ) {
    return this.inquiries.hold(user, id, body);
  }

  @Post(":id/assign")
  @HttpCode(200)
  assign(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(assignInput)) body: z.infer<typeof assignInput>,
  ) {
    return this.inquiries.assign(user, id, body.assigneeId, body.reason);
  }

  /** { parts: [{ description, model?, quantity, unit }], reason? } — the item is quoted in parts (numbered under it). */
  @Post(":id/items/:itemId/parts")
  @HttpCode(200)
  split(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("itemId", ParseUUIDPipe) itemId: string,
    @Body(Validate(splitItemInput)) body: SplitItemInput,
  ) {
    return this.inquiries.split(user, id, itemId, body);
  }

  @Post(":id/notes")
  note(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(noteInput)) body: z.infer<typeof noteInput>,
  ) {
    return this.inquiries.addNote(user, id, body.body);
  }

  @Delete(":id")
  @HttpCode(200)
  @RequirePermissions("inquiries.delete")
  async remove(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.inquiries.remove(user, id);
    return { ok: true };
  }

  /** multipart/form-data with one `file`, and optionally `kind` (urs | drawing | photo | specification | other) and `note`. */
  @Post(":id/files")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD, files: 1 } }))
  upload(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(Validate(attachmentInput)) meta: AttachmentInput,
  ) {
    if (!file) throw new z.ZodError([{ code: "custom", path: ["file"], message: "Choose a file to upload", input: undefined }]);
    return this.inquiries.upload(user, id, file, meta);
  }

  /** Every file on the deal in one zip. */
  @Get(":id/files.zip")
  async zip(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const z = await this.inquiries.zipFiles(user, id);
    res.set({
      "Content-Type": "application/zip",
      "Content-Length": String(z.data.byteLength),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(z.fileName)}`,
      "Cache-Control": "private, no-store",
    });
    return new StreamableFile(Buffer.from(z.data));
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

  /** { kind, note } — what the file is (URS, drawing…) and a note. */
  @Patch(":id")
  describe(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(attachmentInput)) body: AttachmentInput,
  ) {
    return this.inquiries.describeFile(user, id, body);
  }

  @Delete(":id")
  @HttpCode(200)
  async remove(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.inquiries.removeFile(user, id);
    return { ok: true };
  }
}

/** Where a website form sends its key: a field of the form, or the X-Form-Key header. */
const FORM_KEY_FIELDS = ["formKey", "form_key", "formkey"];
export const FORM_KEY_HEADER = "x-form-key";

/**
 * Public endpoint for the RFQ form on a company's website (JSON or form post).
 * The form's key (Settings → Website form) decides the company; without a key,
 * only the sites in PUBLIC_FORM_ORIGINS (keboint.com) may send, for the default
 * company. Also a honeypot field, Turnstile (when configured) and rate limits.
 * The reply says only that it arrived: never a number that tells how many came before.
 */
@ApiTags("public")
@Controller("public/inquiries")
export class WebsiteController {
  constructor(
    private readonly website: WebsiteService,
    private readonly limits: LimitsService,
    private readonly companies: CompaniesService,
  ) {}

  private origins() {
    return (process.env.PUBLIC_FORM_ORIGINS ?? "https://keboint.com,https://www.keboint.com")
      .split(",")
      .map((o) => o.trim().replace(/\/$/, ""))
      .filter(Boolean);
  }

  /** Browsers may send from any site: whether it is accepted is decided per request (the key, or the allowed sites). */
  private cors(req: Request, res: Response) {
    const origin = req.headers.origin;
    if (origin) res.set("Access-Control-Allow-Origin", origin);
    res.set({
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept, X-Form-Key",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    });
    return origin;
  }

  @Public()
  @Options()
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  preflight(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.cors(req, res);
  }

  /** The company this form is for: by its key, or the default company for the allowed sites. Null: refused. */
  private async companyOf(req: Request, raw: Record<string, unknown>) {
    const header = req.headers[FORM_KEY_HEADER];
    const sent = [typeof header === "string" ? header : undefined, ...FORM_KEY_FIELDS.map((f) => raw[f])].find(
      (v) => typeof v === "string" && v.trim(),
    );
    if (typeof sent === "string") return this.companies.byFormKey(sent.trim().toLowerCase());
    const origin = req.headers.origin?.replace(/\/$/, "");
    if (origin && this.origins().includes(origin)) return this.companies.defaultCompany();
    return null;
  }

  @Public()
  @Post()
  async receive(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() raw: Record<string, unknown>) {
    this.cors(req, res);
    const company = await this.companyOf(req, raw ?? {});
    if (!company) {
      res.status(403);
      return { ok: false, message: "This website is not allowed to send inquiries." };
    }
    CompanyContext.set(company);
    // The website form is a plan feature.
    if (companyRefusal(company, "POST") || !(await this.limits.allows("website_form", company))) {
      res.status(403);
      return { ok: false, message: "Inquiries cannot be received right now. Please contact us on WhatsApp or by email." };
    }
    const ip = req.ip ?? "local";
    this.website.limit(`inquiry:${ip}`, 5, 10 * 60_000);
    const fields = normalizeFields(raw ?? {});
    // Bots fill every field, including the hidden one: pretend it worked and drop it.
    if (fields.honeypot) return { ok: true, message: "Thank you." };
    const input = websiteInquiry.parse(fields);
    if (!(await this.website.human(raw?.["cf-turnstile-response"] ?? raw?.turnstileToken, ip))) {
      res.status(403);
      return {
        ok: false,
        message: "We could not confirm you are not a robot. Please reload the page and try again, or contact us on WhatsApp.",
      };
    }
    this.website.limit(`inquiry:all:${company.id}`, Number(process.env.PUBLIC_INQUIRIES_PER_HOUR) || 40, 60 * 60_000);
    await this.website.receive(input);
    res.status(201);
    return { ok: true, message: "Thank you. We have your request. Our sourcing team will reply within one working day." };
  }
}
