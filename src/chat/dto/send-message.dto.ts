import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { API_CONTRACT } from 'src/common/api-contract';

/** Trims a string body; anything else is left for IsString to reject. */
export const trimBody = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class SendMessageDto {
  /** 1 to 2,000 characters after trimming. NUL is refused (Postgres rejects it). */
  @Transform(trimBody)
  @IsString()
  @MinLength(1)
  @MaxLength(API_CONTRACT.limits.chatMessageMax)
  // eslint-disable-next-line no-control-regex -- NUL is the character refused
  @Matches(/^[^\u0000]*$/, { message: 'body must not contain NUL characters' })
  body!: string;
}
