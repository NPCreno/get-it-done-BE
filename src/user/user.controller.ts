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
  UnauthorizedException 
} from '@nestjs/common';
import { UserService } from './user.service';
import { UserCleanupResponse } from './models/userCleanupResponse';
import { CreateUserDto } from './dto/create-user-dto';
import { UpdateUserDto } from './dto/update-user-dto';
import { AuthorizeGuard } from 'src/auth/guards/authorize.guard';
import { AuthenticatedRequest } from 'src/auth/Interfaces/authenticatedRequest';

@Controller('api/user')
export class UserController {

    constructor(private userService: UserService){}

    @Post('create')
    async create(@Body() userDto: CreateUserDto): Promise<{
        status: string;
        message: string;
        data?: UserCleanupResponse | null;
        error?: any;
    }> {
        return this.userService.createUser(userDto);
    }

    @Post('loginEmail')
    async loginEmail(@Body() credentials: { email: string; password: string }) {
        return this.userService.loginEmail(credentials);
    }

    @Post('loginUsername')
    async loginUsername(@Body() credentials: { username: string; password: string }) {
        return this.userService.loginUsername(credentials);
    }

    @UseGuards(AuthorizeGuard)
    @Get('get/:id')
    async findOne(
        @Param('id') id: string, 
        @Req() req: AuthenticatedRequest
    ): Promise<UserCleanupResponse | null> {
        const tokenUser = req.user;
        if (tokenUser.user_id !== id && tokenUser.role !== 'admin') {
            throw new UnauthorizedException('Access denied: Not authorized to view this data.');
        }
        const user = await this.userService.findOne(id);
        if (!user) {
            throw new NotFoundException(`User with user_id ${id} not found`);
        }
        return user;
    }
    
    @UseGuards(AuthorizeGuard)
    @Get('getAll')
    async findAll(@Req() req: AuthenticatedRequest): Promise<UserCleanupResponse[]> {
        const tokenUser = req.user;
        if (tokenUser.role !== 'admin') {
            throw new UnauthorizedException('Access denied: Admin only.');
        }
        return this.userService.findAll();
    }
    
    @UseGuards(AuthorizeGuard)
    @Delete(':id')
    async softDeleteOne(
        @Param('id') user_id: string, 
        @Req() req: AuthenticatedRequest
    ): Promise<{
        status: string;
        message: string;
        error?: any;
    }> {
        const tokenUser = req.user;
        if (tokenUser.user_id !== user_id && tokenUser.role !== 'admin') {
            throw new UnauthorizedException('Access denied: Not authorized to perform this action.');
        }
        return this.userService.softDeleteOne(user_id, tokenUser.user_id);
    }

    @UseGuards(AuthorizeGuard)
    @Delete(':id/hard')
    async hardDeleteOne(
        @Param('id') user_id: string, 
        @Req() req: AuthenticatedRequest
    ): Promise<{
        status: string;
        message: string;
        error?: any;
    }> {
        const tokenUser = req.user;
        if (tokenUser.role !== 'admin') {
            throw new UnauthorizedException('Access denied: Admin only.');
        }
        return this.userService.hardDeleteOne(user_id, tokenUser.user_id);
    }
    
    @UseGuards(AuthorizeGuard)
    @Patch('update/:user_id')
    async update(
        @Param('user_id') user_id: string,
        @Body() updateUserDto: UpdateUserDto,
        @Req() req: AuthenticatedRequest
    ): Promise<UserCleanupResponse> {
        const tokenUser = req.user;
        if (tokenUser.user_id !== user_id && tokenUser.role !== 'admin') {
            throw new UnauthorizedException('Access denied: Not authorized to update this user.');
        }
        return this.userService.updateOne(user_id, updateUserDto);
    }
}