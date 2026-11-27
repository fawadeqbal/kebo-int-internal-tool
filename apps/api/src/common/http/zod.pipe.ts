import { Injectable, PipeTransform } from "@nestjs/common";
import { withNewNames } from "@kebo/shared";
import type { z } from "zod";

/** Validates a body or query with a shared @kebo/shared schema; failures become 422 with field errors (see the error filter). */
@Injectable()
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    // An old name is read as today's here too: the fields of an uploaded form are parsed after the middleware.
    return this.schema.parse(withNewNames(value ?? {}));
  }
}

export const Validate = <S extends z.ZodType>(schema: S) => new ZodPipe(schema);
