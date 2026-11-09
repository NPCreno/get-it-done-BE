import { 
    Controller, 
    Post, 
    Patch, 
    Delete, 
    Get, 
    Body, 
    Param, 
    NotFoundException, 
    UseGuards, 
    Req, 
    UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { getClientIp } from './client-ip';

@Controller('api/auth')
export class AuthController {

    constructor(private authService: AuthService){}

    @Post('refresh')
    async refreshToken(
      @Body() {refreshToken}: {refreshToken: string},
      @Req() req: Request,
    ) {
      console.log("refreshToken triggered")
      return this.authService.refreshAccessToken(refreshToken, getClientIp(req));
    }
}