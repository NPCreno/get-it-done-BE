import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Users } from './models/user.entity';
import { Repository } from 'typeorm';
import { catchError, from, map, Observable, of, switchMap, throwError } from 'rxjs';
import { User } from './models/user.interface';
import { CreateUserDto } from './dto/create-user-dto';
import { UpdateUserDto } from './dto/update-user-dto';
import { AuthService } from 'src/auth/auth.service';

@Injectable()
export class UserService {
    constructor (
        @InjectRepository(Users) private readonly userRepository: Repository<Users>,
        private readonly authService: AuthService,
    ){}
    
    private generateUserId(): string {
      const randomNumber = Math.floor(Math.random() * 1_000_000_000); // 0 to 999,999,999
      return 'user-' + randomNumber.toString().padStart(9, '0');
    }

    createUser(userDto: CreateUserDto): Observable<User> {
      return this.authService.hashPassword(userDto.password).pipe(
        switchMap((passwordHash: string) => {
          const user_id = this.generateUserId();
          const newUser = this.userRepository.create({  // Modify userDto to include the hashed password
            ...userDto, 
            password: passwordHash,  // Replace the plain password with the hashed one
            role: 'standard',
            user_id,
            status: 'active',
          });

        // Save the new user with the hashed password
        return from(this.userRepository.save(newUser)).pipe(
          map((user: User) => { 
            const {password, ...result} = user;  //Don't include password in the response
            return result;
          }),
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
        })
      );
    }

    findOne(user_id: string): Observable<User | null> {
      return from(this.userRepository.findOne({ where: { user_id } })).pipe(
        map((user: User | null) => {
          if (!user) return null; // Or throw NotFoundException in service if you prefer
          const { password, ...result } = user; // Exclude password
          return result;
        })
      );
    }

    findAll(): Observable<User[]>{
      return from(this.userRepository.find()).pipe(
        map((users: User[]) => { 
          return users.map((user: User) => {
            const { password, ...result } = user; // Exclude password from each user
            return result;
          });
        })
      );
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


  async updateOne(user_id: string, updateUserDto: UpdateUserDto): Promise<User> {
    const user = await this.userRepository.findOne({ where: { user_id } });
    if (!user) {
      throw new NotFoundException(`User with ID ${user_id} not found`);
    }

    const fieldsTriggeringUpdate = ['fullname', 'username', 'password'] as const;
    const isSensitiveFieldUpdated = fieldsTriggeringUpdate.some(
      (field) => field in updateUserDto && updateUserDto[field] !== user[field]
    );

    if (isSensitiveFieldUpdated) {  //go through this function if updates includes the array above
      const now = new Date();
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(now.getMonth() - 6);

      if (user.updatedAt && user.updatedAt > sixMonthsAgo) {
        throw new BadRequestException(
          `You can only update name, username, or password once every 6 months. Last update: ${user.updatedAt.toISOString()}`
        );
      }
    }

    await this.userRepository.update({ user_id }, updateUserDto);
    
    const updatedUser = await this.userRepository.findOne({ where: { user_id } });
    if (!updatedUser) throw new NotFoundException(`Updated user not found`);

    const { password, ...sanitizedUser } = updatedUser;
    return sanitizedUser;
  }

    validateUser(emailOrUsername: string, password: string): Observable<User> {
      return this.findByEmailOrUsername(emailOrUsername).pipe(
        switchMap((user: User) => {
          if (!user || !user.password) {
            throw new Error('Password not found for user');
          }
          
          return this.authService.comparePasswords(password, user.password).pipe(
            map((match: boolean) => {
              if (match) {
                const { password, ...result } = user; // Don't include password in the response
                return result;
              } else {
                throw new UnauthorizedException('Invalid credentials');
              }
            })
          );
        })
      );
    }

    findByEmailOrUsername(emailOrUsername: string): Observable<User | null> {
      const isEmail = /\S+@\S+\.\S+/.test(emailOrUsername);
      
      if (isEmail) {
        return from(this.userRepository.findOne({ where: { email: emailOrUsername } }));
      } else {
        return  from(this.userRepository.findOne({ where: { username: emailOrUsername } }));
      }
    }

    loginEmail(user: User): Observable<string>{
      const { email, password } = user;

      if (!email || !password) {
        throw new Error('Email and password are required.');
      }
      return this.validateUser(email, password).pipe(
        switchMap((user: User)=>{
          if(user){
            return this.authService.generateJWT(user).pipe(
              map((jwt: string) => jwt)
            )
          }
          else{
            throw new UnauthorizedException('Invalid credentials');
          }
        })
      )}

    loginUsername(user: User): Observable<string>{
      const { username, password } = user;

      if (!username || !password) {
        throw new Error('username and password are required.');
      }
      return this.validateUser(username, password).pipe(
        switchMap((user: User)=>{
          if(user){
            return this.authService.generateJWT(user).pipe(
              map((jwt: string) => jwt)
            )
          }
          else{
            throw new UnauthorizedException('Invalid credentials');
          }
        })
    )}
}
