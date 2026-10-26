import { Injectable, PipeTransform } from "@nestjs/common";
import type { z } from "zod";

/** Validates a body or query with a shared @kebo/shared schema; failures become 422 with field errors (see the error filter). */
@Injectable()
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    return this.schema.parse(value ?? {});
  }
}

export const Validate = <S extends z.ZodType>(schema: S) => new ZodPipe(schema);
