import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { API_CONTRACT } from 'src/common/api-contract';

const { limits, patterns } = API_CONTRACT;

/** No role, tier, email, user_id or status: those are never client-settable. */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(limits.fullnameMin)
  @MaxLength(limits.fullnameMax)
  fullname?: string;

  @IsOptional()
  @IsString()
  @MinLength(limits.usernameMin)
  @MaxLength(limits.usernameMax)
  @Matches(new RegExp(patterns.username))
  username?: string;

  @IsOptional()
  @IsString()
  @MinLength(limits.passwordMin)
  @MaxLength(limits.passwordMax)
  @Matches(new RegExp(patterns.password))
  password?: string;

  @IsOptional()
  @IsIn([...API_CONTRACT.booleanStrings])
  enableNotifications?: string;

  @IsOptional()
  @IsIn([...API_CONTRACT.themes])
  theme?: string;

  @IsOptional()
  @IsIn([...API_CONTRACT.booleanStrings])
  soundFx?: string;
}
