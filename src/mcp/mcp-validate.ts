import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';

function messages(errors: ValidationError[]): string[] {
  return errors.flatMap((e) => [
    ...Object.values(e.constraints ?? {}),
    ...messages(e.children ?? []),
  ]);
}

/**
 * Runs the REST DTO's class-validator rules on a tool's mapped input, so the
 * MCP tools and the REST routes cannot drift apart. Same options as the global
 * ValidationPipe (no implicit conversion), but unknown keys are an error: the
 * mapping is ours, so one would be a bug. A failure is a 400 with the messages.
 */
export async function toDto<T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
): Promise<T> {
  const defined = Object.fromEntries(
    Object.entries(plain).filter(([, v]) => v !== undefined),
  );
  const dto = plainToInstance(cls, defined, {
    enableImplicitConversion: false,
  });
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
    validationError: { target: false, value: false },
  });
  if (errors.length > 0) throw new BadRequestException(messages(errors));
  return dto;
}
