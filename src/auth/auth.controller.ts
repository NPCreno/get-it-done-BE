import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { getClientIp } from './client-ip';

@Controller('api/auth')
export class AuthController {

    constructor(private authService: AuthService){}

    @Post('refresh')
    @HttpCode(200)
    async refreshToken(
      @Body() body: { refreshToken?: unknown },
      @Req() req: Request,
    ) {
      const data = await this.authService.refresh(body?.refreshToken, getClientIp(req));
      return {
        status: 'success',
        message: 'Access token generated successfully',
        data,
      };
    }

    @Post('logout')
    @HttpCode(204)
    async logout(@Body() body: { refreshToken?: unknown }): Promise<void> {
      await this.authService.logout(body?.refreshToken);
    }
}
