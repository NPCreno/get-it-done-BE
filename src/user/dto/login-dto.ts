import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { trimString } from '../identifier';

export class LoginEmailDto {
  /** Trimmed before validation (BUG-01); a bad email gets the same error. */
  @Transform(trimString)
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}

export class LoginUsernameDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  username!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
