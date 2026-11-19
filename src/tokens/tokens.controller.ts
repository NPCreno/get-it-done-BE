import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthorizeGuard } from 'src/auth/guards/authorize.guard';
import { AuthUserId } from 'src/auth/decorators/auth-user-id.decorator';
import { RateLimit } from 'src/auth/rate-limit/rate-limit.decorator';
import { CreateTokenDto } from './dto/create-token.dto';
import { TokensService } from './tokens.service';

/**
 * Personal access tokens (FEAT-07a), managed by the website with its JWT.
 * The tokens themselves work only on /mcp. AuthorizeGuard is on the class so
 * it runs before the create route's @RateLimit guard (keyed on the token user).
 */
@UseGuards(AuthorizeGuard)
@Controller('api/tokens')
export class TokensController {
  constructor(private readonly tokens: TokensService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@AuthUserId() userId: string) {
    return { status: 'success', data: await this.tokens.list(userId) };
  }

  /** The only response that ever carries the secret. */
  @RateLimit('tokenCreate')
  @Post()
  @Header('Cache-Control', 'no-store')
  async create(@AuthUserId() userId: string, @Body() dto: CreateTokenDto) {
    return {
      status: 'success',
      data: await this.tokens.create(userId, dto.name, dto.expires_in_days),
    };
  }

  @Delete(':id')
  @Header('Cache-Control', 'no-store')
  async revoke(@AuthUserId() userId: string, @Param('id') id: string) {
    return { status: 'success', data: await this.tokens.revoke(userId, id) };
  }
}
