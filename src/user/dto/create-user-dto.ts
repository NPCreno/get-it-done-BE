import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { API_CONTRACT } from 'src/common/api-contract';
import { trimString } from '../identifier';

const { limits, patterns } = API_CONTRACT;

export class CreateUserDto {
  @IsString()
  @MinLength(limits.fullnameMin)
  @MaxLength(limits.fullnameMax)
  fullname!: string;

  @IsString()
  @MinLength(limits.usernameMin)
  @MaxLength(limits.usernameMax)
  @Matches(new RegExp(patterns.username))
  username!: string;

  /** Trimmed before validation (BUG-01); a bad email gets the same error. */
  @Transform(trimString)
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(limits.passwordMin)
  @MaxLength(limits.passwordMax)
  @Matches(new RegExp(patterns.password))
  password!: string;
}
