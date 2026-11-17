import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { API_CONTRACT } from 'src/common/api-contract';

const L = API_CONTRACT.limits;

export class AddMemberDto {
  /** Exact username (no case folding), same rules as signup. */
  @IsString()
  @MinLength(L.usernameMin)
  @MaxLength(L.usernameMax)
  @Matches(new RegExp(API_CONTRACT.patterns.username))
  username!: string;
}
