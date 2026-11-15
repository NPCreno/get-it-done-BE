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

export class ListNotificationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(API_CONTRACT.limits.notificationsPageMax)
  limit?: number;

  /** Opaque; produced by a previous response's next_cursor. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  cursor?: string;
}
