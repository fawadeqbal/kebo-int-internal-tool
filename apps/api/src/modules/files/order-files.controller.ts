import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import {
  ORDER_FILE_SOURCES,
  orderFileAttachInput,
  orderFilesShareInput,
  orderFilesZipQuery,
  orderFileUpdateInput,
  orderFileUploadInput,
  type OrderFileAttachInput,
  type OrderFilesShareInput,
  type OrderFileSource,
  type OrderFilesZipQuery,
  type OrderFileUpdateInput,
  type OrderFileUploadInput,
} from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { OrderFilesService } from "./order-files.service";

const MAX_UPLOAD = 200 * 1024 * 1024; // hard ceiling; the configured limit is checked in the service
const uuid = new ParseUUIDPipe();
const sourceParam = Validate(z.enum(ORDER_FILE_SOURCES));
const noFile = () => new z.ZodError([{ code: "custom", path: ["file"], message: "Choose a file to upload", input: undefined }]);

/**
 * Documents v3: every file of an order in one list, and the same tools on each
 * (rename, say what it is, attach to, replace with a newer one, delete), plus
 * many at once (zip) and noting a share. Who may change a file follows what it
 * is attached to (see OrderFilesService). Each file opens at /files/:id.
 */
@ApiTags("order files")
@Controller("orders/:id/files")
export class OrderFilesController {
  constructor(private readonly files: OrderFilesService) {}

  @Get()
  list(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string) {
    return this.files.list(user, id);
  }

  /** multipart/form-data: one `file`, and `step` or `section` (a section of the order page: its stage follows), `kind`, `note`, `attachTo` ("paper:<kind or doc:id>", "checklist:<item id or key>"). */
  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD, files: 1 } }))
  upload(
    @CurrentUser() user: SessionUser,
    @Param("id", uuid) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(Validate(orderFileUploadInput)) meta: OrderFileUploadInput,
  ) {
    if (!file) throw noFile();
    return this.files.upload(user, id, file, meta);
  }

  /** ?files=attachment:<id>,payment:<id> — those files in one zip; every file of the order without it. */
  @Get("zip")
  async zip(
    @CurrentUser() user: SessionUser,
    @Param("id", uuid) id: string,
    @Query(Validate(orderFilesZipQuery)) q: OrderFilesZipQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const z = await this.files.zip(user, id, q.files);
    res.set({
      "Content-Type": "application/zip",
      "Content-Length": String(z.data.byteLength),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(z.fileName)}`,
      "Cache-Control": "private, no-store",
    });
    return new StreamableFile(Buffer.from(z.data));
  }

  /** { files, papers, via: share | download, message? } — noted in History; the app sends nothing. */
  @Post("share")
  @HttpCode(200)
  share(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string, @Body(Validate(orderFilesShareInput)) body: OrderFilesShareInput) {
    return this.files.share(user, id, body);
  }

  /** { name?, kind?, note? } */
  @Patch(":source/:fileId")
  update(
    @CurrentUser() user: SessionUser,
    @Param("id", uuid) id: string,
    @Param("source", sourceParam) source: OrderFileSource,
    @Param("fileId", uuid) fileId: string,
    @Body(Validate(orderFileUpdateInput)) body: OrderFileUpdateInput,
  ) {
    return this.files.update(user, id, source, fileId, body);
  }

  /** { to: paper | checklist | step, target } */
  @Post(":source/:fileId/attach")
  @HttpCode(200)
  attach(
    @CurrentUser() user: SessionUser,
    @Param("id", uuid) id: string,
    @Param("source", sourceParam) source: OrderFileSource,
    @Param("fileId", uuid) fileId: string,
    @Body(Validate(orderFileAttachInput)) body: OrderFileAttachInput,
  ) {
    return this.files.attach(user, id, source, fileId, body);
  }

  /** multipart/form-data with one `file`: the newer one (the deal's files keep the old one as an earlier version). */
  @Post(":source/:fileId/replace")
  @HttpCode(200)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD, files: 1 } }))
  replace(
    @CurrentUser() user: SessionUser,
    @Param("id", uuid) id: string,
    @Param("source", sourceParam) source: OrderFileSource,
    @Param("fileId", uuid) fileId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw noFile();
    return this.files.replace(user, id, source, fileId, file);
  }

  @Delete(":source/:fileId")
  @HttpCode(200)
  remove(
    @CurrentUser() user: SessionUser,
    @Param("id", uuid) id: string,
    @Param("source", sourceParam) source: OrderFileSource,
    @Param("fileId", uuid) fileId: string,
  ) {
    return this.files.remove(user, id, source, fileId);
  }
}
