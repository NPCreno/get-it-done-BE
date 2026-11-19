import { Transform } from 'class-transformer';
import {
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { API_CONTRACT } from 'src/common/api-contract';
import { trimBody } from 'src/chat/dto/send-message.dto';

export class CreateTokenDto {
  /** 1 to 60 characters after trimming. */
  @Transform(trimBody)
  @IsString()
  @MinLength(1)
  @MaxLength(API_CONTRACT.limits.tokenNameMax)
  name!: string;

  /** 30, 90 or 365; null means no expiry; omitted means 90. */
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsIn([...API_CONTRACT.tokens.expiresInDays], {
    message: 'expires_in_days must be 30, 90, 365 or null',
  })
  expires_in_days?: number | null;
}
