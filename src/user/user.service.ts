import { ConflictException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Users } from './models/user.entity';
import { Repository } from 'typeorm';
import { catchError, from, map, Observable, of, throwError } from 'rxjs';
import { User } from './models/user.interface';
import { CreateUserDto } from './dto/create-user-dto';
import { UpdateUserDto } from './dto/update-user-dto';

@Injectable()
export class UserService {
    constructor (
        @InjectRepository(Users) private readonly userRepository: Repository<Users>
    ){}

    createUser(userDto: CreateUserDto): Observable<User> {
        const newUser = this.userRepository.create(userDto);
        return from(this.userRepository.save(newUser)).pipe(
          catchError((error) => {
            if (error.code === '23505') { // Postgres unique violation
              const detail = error.detail || '';
              if (detail.includes('username')) {
                return throwError(() => new ConflictException('Username already exists.'));
              }
              if (detail.includes('email')) {
                return throwError(() => new ConflictException('Email already exists.'));
              }
              return throwError(() => new ConflictException('Duplicate entry.'));
            }
            return throwError(() => new InternalServerErrorException('Failed to create user.'));
          })
        );
      }

    findOne(userId: number): Observable<User | null> {
        return from(this.userRepository.findOne({ where: { id: userId } }));
      }

    findAll(): Observable<User[]>{
        return from(this.userRepository.find());
    }

    softDeleteOne(id: number): Observable<any> {
        const timestamp = new Date(); // current timestamp
      
        return from(
          this.userRepository.update(id, { deletedAt: timestamp })
        ).pipe(
          map(() => ({ message: 'User soft-deleted successfully', deletedAt: timestamp })),
          catchError((error) => {
            console.error('Soft delete failed:', error);
            return of({ message: 'Failed to soft-delete user', error });
          })
        );
      }

    hardDeleteOne(id: number):  Observable<any>{
        return from(this.userRepository.delete(id));
    }


    updateOne(id: number, updateUserDto: UpdateUserDto):  Observable<any>{
        return from(this.userRepository.update(id, updateUserDto)).pipe(
            catchError((error) => {
              if (error.code === '23505') { // Postgres unique violation
                const detail = error.detail || '';
                if (detail.includes('username')) {
                  return throwError(() => new ConflictException('Username already exists.'));
                }
                if (detail.includes('email')) {
                  return throwError(() => new ConflictException('Email already exists.'));
                }
                return throwError(() => new ConflictException('Duplicate entry.'));
              }
              return throwError(() => new InternalServerErrorException('Failed to update user.'));
            })
          );;
    }
}
