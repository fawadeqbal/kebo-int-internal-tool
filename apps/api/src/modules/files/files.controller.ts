import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Res, StreamableFile } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { attachmentInput, type AttachmentInput } from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { InquiriesService } from "../inquiries/inquiries.service";
import { FilesService } from "./files.service";

/**
 * Any stored file by its id: a deal's document, a payment's proof, an
 * expense's receipt, the photo sent with a submission. Uploading and removing
 * a proof stay on its record; a deal's file is described and removed here.
 */
@ApiTags("files")
@Controller("files")
export class FilesController {
  constructor(
    private readonly files: FilesService,
    private readonly inquiries: InquiriesService,
  ) {}

  @Get(":id")
  async download(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const f = await this.files.open(user, id);
    res.set({
      "Content-Type": f.mimeType,
      "Content-Length": String(f.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    });
    return new StreamableFile(f.stream);
  }

  /** { kind, note } — what a deal's file is (URS, drawing…) and a note. */
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
