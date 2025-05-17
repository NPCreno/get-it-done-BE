import { Controller, Post, Patch, Delete, Get, Body, Param, NotFoundException, UseGuards } from '@nestjs/common';
import { UserService } from './user.service';
import { User } from './models/user.interface';
import { catchError, map, Observable, of } from 'rxjs';
import { Users } from './models/user.entity';
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
    findOne(@Param('user_id') user_id: string): Observable<User> {
    return this.userService.findOne(user_id).pipe(
        map(user => {
        if (!user) throw new NotFoundException(`User with user_id ${user_id} not found`);
        return user;
        })
    );
    }
    
    @UseGuards(AuthorizeGuard)
    @Get('getAll')
    findAll(){
        return this.userService.findAll();
    }

    @Delete(':id')
    softDeleteOne(@Param('id')id: string):Observable<User> {
        return this.userService.softDeleteOne(Number(id));
    }

    @Delete(':id/hard')
    hardDeleteOne(@Param('id')id: string):Observable<User> {
        return this.userService.hardDeleteOne(Number(id));
    }
    
    @UseGuards(AuthorizeGuard)
    @Patch('update/:user_id')
    update(@Param('user_id') user_id: string,
    @Body() updateUserDto: UpdateUserDto
    ): Observable<User> {
    return this.userService.updateOne(user_id, updateUserDto);
    }
}
