import { Controller, Post, Patch, Delete, Get, Body, Param, NotFoundException, UseGuards, Req, UnauthorizedException } from '@nestjs/common';
import { UserService } from './user.service';
import { User } from './models/user.interface';
import { catchError, map, Observable, of } from 'rxjs';
import { CreateUserDto } from './dto/create-user-dto';
import { UpdateUserDto } from './dto/update-user-dto';
import { AuthorizeGuard } from 'src/auth/guards/authorize.guard';

@Controller('api/user')
export class UserController {

    constructor(private userService: UserService){}

    @Post('create')
    create(@Body()userDto: CreateUserDto): Observable<User | Object>{
        return this.userService.createUser(userDto).pipe(
            map((user: User) => user), 
            catchError(err => of({error: err.message}))
        );
    }

    @Post('loginEmail')
    loginEmail(@Body()user: User): Observable<Object>{
        return this.userService.loginEmail(user).pipe(
            map((jwt: string) => {
                return{
                    access_token: jwt
                }
            })
        )
    }

    @Post('loginUsername')
    loginUsername(@Body()user: User): Observable<Object>{
        return this.userService.loginUsername(user).pipe(
            map((jwt: string) => {
                return{
                    access_token: jwt
                }
            })
        )
    }

    @UseGuards(AuthorizeGuard)
    @Get('get/:id')
    findOne(@Param('id') id: string, @Req() req: Request): Observable<User> {
    const tokenUserId = req['user'];
    if (tokenUserId.user.user_id !== id) {
        throw new UnauthorizedException('Access denied: Not your data.');
    }
    return this.userService.findOne(id).pipe(
        map(user => {
        if (!user) throw new NotFoundException(`User with user_id ${id} not found`);
        return user;
        })
    );
    }
    
    @UseGuards(AuthorizeGuard)
    @Get('getAll')
    findAll(@Req() req: Request): Observable<User[]> {
        const tokenUserId = req['user'];
        if (tokenUserId.user.role !== 'admin') {
          throw new UnauthorizedException('Access denied: Admin only.');
        }
        return this.userService.findAll();
    }
    
    @UseGuards(AuthorizeGuard)
    @Delete(':id')
    softDeleteOne(@Param('id')user_id: string, @Req() req: Request):Promise<{
            status: string;
            message: string;
            error?: any;
          }> {
        const tokenUserId = req['user'];
        return this.userService.softDeleteOne(user_id, tokenUserId.user.user_id);
    }

    @UseGuards(AuthorizeGuard)
    @Delete(':id/hard')
    hardDeleteOne(@Param('id')user_id: string, @Req() req: Request):Promise<{
            status: string;
            message: string;
            error?: any;
          }> {
        const tokenUserId = req['user'];
        return this.userService.hardDeleteOne(user_id, tokenUserId.user.user_id);
    }
    
    @UseGuards(AuthorizeGuard)
    @Patch('update/:user_id')
    async update(
    @Param('user_id') user_id: string,
    @Body() updateUserDto: UpdateUserDto,
    @Req() req: Request
    ): Promise<User> {
    const tokenUserId = req['user'];
    if (tokenUserId.user.user_id !== user_id) {
        throw new UnauthorizedException('Access denied: Not your data.');
    }
    return this.userService.updateOne(user_id, updateUserDto);
    }
}