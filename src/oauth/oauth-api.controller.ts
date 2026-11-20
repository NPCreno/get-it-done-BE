import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthorizeGuard } from 'src/auth/guards/authorize.guard';
import { AuthUserId } from 'src/auth/decorators/auth-user-id.decorator';
import { RateLimit } from 'src/auth/rate-limit/rate-limit.decorator';
import {
  AuthorizeDecisionBodyDto,
  AuthorizeQueryDto,
} from './dto/authorize.dto';
import { OAuthAuthorizeService } from './oauth-authorize.service';
import { OAuthGrantsService } from './oauth-grants.service';

/**
 * The website's side of OAuth (FEAT-07c, used by the FE consent page and
 * "Connected apps"), with the website JWT. AuthorizeGuard is on the class so
 * it runs before the decision's @RateLimit guard (keyed on the token user).
 * The consent decision is bound to the JWT's user.
 */
@UseGuards(AuthorizeGuard)
@Controller('api/oauth')
export class OAuthApiController {
  constructor(
    private readonly authorize: OAuthAuthorizeService,
    private readonly grants: OAuthGrantsService,
  ) {}

  @Get('authorize/check')
  @Header('Cache-Control', 'no-store')
  async check(@Query() query: AuthorizeQueryDto) {
    return { status: 'success', data: await this.authorize.check(query) };
  }

  @RateLimit('oauthAuthorize')
  @Post('authorize')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async decide(
    @AuthUserId() userId: string,
    @Body() dto: AuthorizeDecisionBodyDto,
  ) {
    const { decision, ...params } = dto;
    return {
      status: 'success',
      data: await this.authorize.decide(userId, params, decision),
    };
  }

  @Get('grants')
  @Header('Cache-Control', 'no-store')
  async list(@AuthUserId() userId: string) {
    return { status: 'success', data: await this.grants.list(userId) };
  }

  @Delete('grants/:id')
  @Header('Cache-Control', 'no-store')
  async revoke(@AuthUserId() userId: string, @Param('id') id: string) {
    return { status: 'success', data: await this.grants.revoke(userId, id) };
  }
}
