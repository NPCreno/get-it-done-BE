import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { UserEntity } from './models/user.entity';
import { Repository } from 'typeorm';
import { from, Observable } from 'rxjs';
import { User } from './models/user.interface';

@Injectable()
export class UserService {
    constructor (
        @InjectRepository(UserEntity) private readonly userRepository: Repository<UserEntity>
    ){}

    createUser(user: User): Observable<User>{
        const newUser = this.userRepository.create(user);
        return from(this.userRepository.save(newUser));
    }

    findOne(userId: number): Observable<User | null> {
        return from(this.userRepository.findOne({ where: { id: userId } }));
      }

    findAll(): Observable<User[]>{
        return from(this.userRepository.find());
    }

    deleteOne(id: number):  Observable<any>{
        return from(this.userRepository.delete(id));
    }

    updateOne(id: number, user: User):  Observable<any>{
        return from(this.userRepository.update(id, user));
    }
}
