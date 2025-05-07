import { Controller, Post, Patch, Delete, Get, Body, Param, NotFoundException } from '@nestjs/common';
import { UserService } from './user.service';
import { User } from './models/user.interface';
import { map, Observable } from 'rxjs';
import { Users } from './models/user.entity';

@Controller('api/user')
export class UserController {

    constructor(private userService: UserService){}

    @Post('create')
    create(@Body()user: User): Observable<User>{
        return this.userService.createUser(user);
    }

    @Get(':id')
    findOne(@Param('id') id: string): Observable<User> {
        return this.userService.findOne(+id).pipe(
            map(user => {
            if (!user) throw new NotFoundException(`User with ID ${id} not found`);
            return user;
            })
        );
    }

    @Get()
    findAll(){
        return this.userService.findAll();
    }

    @Delete('id')
    deleteOne(@Param('id')id: string):Observable<User> {
        return this.userService.deleteOne(Number(id));
    }

    @Patch(':id')
    updateOne(@Param('id')id: string, @Body() user:User):Observable<User>{
        return this.userService.updateOne(Number(id), user);
    }

}
