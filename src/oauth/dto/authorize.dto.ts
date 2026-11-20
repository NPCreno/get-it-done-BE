import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { API_CONTRACT } from 'src/common/api-contract';

const MAX = 4000;

/**
 * The authorize request's parameters (FEAT-07c), as the consent page passes
 * them through. Only shapes are checked here; the OAuth rules (and whether a
 * failure is fatal or goes back to the client) are in validateAuthorize.
 */
export class AuthorizeQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX)
  response_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX)
  client_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX)
  redirect_uri?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX)
  code_challenge?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX)
  code_challenge_method?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX)
  scope?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX)
  resource?: string;
}

/** The consent decision: the same parameters plus allow or deny. */
export class AuthorizeDecisionBodyDto {
  @IsIn([...API_CONTRACT.oauth.decisions])
  decision!: 'allow' | 'deny';

  @IsOptional()
  @IsString()
  @MaxLength(MAX)
  response_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX)
  client_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX)
  redirect_uri?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX)
  code_challenge?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX)
  code_challenge_method?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX)
  scope?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX)
  resource?: string;
}
