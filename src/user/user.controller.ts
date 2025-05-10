import { Controller, Post, Patch, Delete, Get, Body, Param, NotFoundException } from '@nestjs/common';
import { UserService } from './user.service';
import { User } from './models/user.interface';
import { map, Observable } from 'rxjs';
import { Users } from './models/user.entity';
import { CreateUserDto } from './dto/create-user-dto';
import { UpdateUserDto } from './dto/update-user-dto';

@Controller('api/user')
export class UserController {

    constructor(private userService: UserService){}

    @Post('create')
    create(@Body()userDto: CreateUserDto): Observable<User>{
        return this.userService.createUser(userDto);
    }

    @Get('get/:id')
    findOne(@Param('id') id: string): Observable<User> {
        return this.userService.findOne(+id).pipe(
            map(user => {
            if (!user) throw new NotFoundException(`User with ID ${id} not found`);
            return user;
            })
        );
    }

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
    
    @Patch(':id')
    updateOne(@Param('id')id: string, @Body() updateUserDto:UpdateUserDto):Observable<User>{
        return this.userService.updateOne(Number(id), updateUserDto);
    }
}
