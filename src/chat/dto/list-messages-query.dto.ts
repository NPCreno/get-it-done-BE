import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { API_CONTRACT } from 'src/common/api-contract';

export class ListMessagesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(API_CONTRACT.limits.chatMessagesPageMax)
  limit?: number;

  /** Opaque; produced by a previous response's next_cursor. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}
