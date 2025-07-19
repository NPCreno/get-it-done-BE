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
    UnauthorizedException, 
    Ip } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('api/auth')
export class AuthController {

    constructor(private authService: AuthService){}

    @Post('refresh')
    async refreshToken(
      @Body('refreshToken') refreshToken: string,
      @Ip() ipAddress: string
    ) {
      // return this.authService.generateRefreshToken(refreshToken, ipAddress);
    }
}