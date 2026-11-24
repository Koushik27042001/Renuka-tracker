import type { Request, RequestHandler } from 'express';
import type { ZodType, output } from 'zod';
import { AppError } from './errors.js';

export function parse<T extends ZodType>(schema: T, input: unknown): output<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new AppError(
    400,
    'Validation failed',
    result.error.issues.map((issue) => ({
      field: issue.path.join('.') || 'request',
      message: issue.code === 'unrecognized_keys' ? 'Unexpected fields' : 'Invalid value',
    })),
  );
}

type Sources = Partial<Record<'body' | 'params' | 'query', ZodType>>;
type Validated<T extends Sources> = { [K in keyof T]: T[K] extends ZodType ? output<T[K]> : never };

export function validateRequest<T extends Sources>(
  schemas: T,
  handler: (input: Validated<T>, req: Request, res: Parameters<RequestHandler>[1]) => unknown,
): RequestHandler {
  return (req, res) => {
    const input = Object.fromEntries(
      Object.entries(schemas).map(([source, schema]) => [
        source,
        parse(schema, req[source as keyof Sources]),
      ]),
    );
    return handler(input as Validated<T>, req, res);
  };
}
