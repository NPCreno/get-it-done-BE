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
  UseFilters,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { UserService } from './user.service';
import { getClientIp } from 'src/auth/client-ip';
import { TokenPair } from 'src/auth/auth.service';
import { UserCleanupResponse } from './models/userCleanupResponse';
import { CreateUserDto } from './dto/create-user-dto';
import { UpdateUserDto } from './dto/update-user-dto';
import { LoginEmailDto, LoginUsernameDto } from './dto/login-dto';
import { AuthorizeGuard } from 'src/auth/guards/authorize.guard';
import { AdminOnlyGuard } from 'src/auth/guards/admin-only.guard';
import { SelfParam } from 'src/auth/guards/self-param.guard';
import { RateLimit } from 'src/auth/rate-limit/rate-limit.decorator';
import { LoginLockedFilter } from 'src/auth/rate-limit/login-locked.filter';
import { AuthUserId } from 'src/auth/decorators/auth-user-id.decorator';

@Controller('api/user')
export class UserController {
  constructor(private userService: UserService) {}

  @RateLimit('signup')
  @Post('create')
  async create(@Body() userDto: CreateUserDto): Promise<{
    status: 'success';
    message: string;
    data: UserCleanupResponse;
  }> {
    return this.userService.createUser(userDto);
  }

  @RateLimit('login')
  @UseFilters(LoginLockedFilter)
  @Post('loginEmail')
  async loginEmail(
    @Body() credentials: LoginEmailDto,
    @Req() req: Request,
  ): Promise<{
    status: string;
    message: string;
    data?: TokenPair;
    error?: any;
  }> {
    const authenticatedUser = await this.userService.loginEmail({
      ...credentials,
      ipAddress: getClientIp(req),
    });
    return authenticatedUser;
  }

  @RateLimit('login')
  @UseFilters(LoginLockedFilter)
  @Post('loginUsername')
  async loginUsername(
    @Body() credentials: LoginUsernameDto,
    @Req() req: Request,
  ): Promise<{
    status: string;
    message: string;
    data?: TokenPair;
    error?: any;
  }> {
    const authenticatedUser = await this.userService.loginUsername({
      ...credentials,
      ipAddress: getClientIp(req),
    });
    return authenticatedUser;
  }

  @UseGuards(AuthorizeGuard, SelfParam('id', { allowAdmin: true }))
  @Get('get/:id')
  async findOne(@Param('id') id: string): Promise<UserCleanupResponse | null> {
    const user = await this.userService.findOne(id);
    if (!user) {
      throw new NotFoundException(`User with user_id ${id} not found`);
    }
    return user;
  }

  @UseGuards(AuthorizeGuard, AdminOnlyGuard)
  @Get('getAll')
  async findAll(): Promise<UserCleanupResponse[]> {
    return this.userService.findAll();
  }

  @UseGuards(AuthorizeGuard, SelfParam('id', { allowAdmin: true }))
  @Delete(':id')
  async softDeleteOne(
    @Param('id') user_id: string,
    @AuthUserId() actorId: string,
  ): Promise<{
    status: string;
    message: string;
    error?: any;
  }> {
    return this.userService.softDeleteOne(user_id, actorId);
  }

  @UseGuards(AuthorizeGuard, AdminOnlyGuard)
  @Delete(':id/hard')
  async hardDeleteOne(
    @Param('id') user_id: string,
    @AuthUserId() actorId: string,
  ): Promise<{
    status: string;
    message: string;
    error?: any;
  }> {
    return this.userService.hardDeleteOne(user_id, actorId);
  }

  @UseGuards(AuthorizeGuard, SelfParam('user_id', { allowAdmin: true }))
  @Patch('update/:user_id')
  async update(
    @Param('user_id') user_id: string,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<UserCleanupResponse> {
    return this.userService.updateOne(user_id, updateUserDto);
  }
}
