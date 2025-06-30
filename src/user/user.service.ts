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

    async createUser(userDto: CreateUserDto): Promise<{
      status: string;
      message: string;
      data?: User | null;
      error?: any;
    }> {
      try {
        // Ensure password is a primitive string
        const password = String(userDto.password);
        
        // Hash the password
        const passwordHash = await this.authService.hashPassword(password).toPromise();
        if (!passwordHash) {
          throw new Error('Failed to hash password');
        }

        const user_id = this.generateUserId();
        
        // Create a new user instance with explicit typing
        const newUser = this.userRepository.create({
          fullname: String(userDto.fullname),
          username: String(userDto.username),
          email: String(userDto.email).toLowerCase(),
          password: String(passwordHash),  // Ensure it's a primitive string
          tier: userDto.tier || 'free',
          role: 'standard',
          user_id,
          status: 'active',
        });
    
        // Save the new user with the hashed password
        const savedUser = await this.userRepository.save(newUser);
        
        // Remove password from the returned object
        const { password: _, ...userWithoutPassword } = savedUser;
    
        return {
          status: 'success',
          message: 'User created successfully',
          data: userWithoutPassword
        };
      } catch (error) {
        console.error('Error creating user:', error);
        
        if (error.code === '23505') { // Postgres unique violation
          const detail = error.detail || '';
          let message = 'Duplicate entry.';
          
          if (detail.includes('username')) {
            message = 'Username already exists.';
          } else if (detail.includes('email')) {
            message = 'Email already exists.';
          }
    
          return {
            status: 'error',
            message,
            error: { message }
          };
        }
    
        return {
          status: 'error',
          message: 'Failed to create user.',
          error: { message: error.message || 'Internal server error' }
        };
      }
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

    async softDeleteOne(user_id: string, tokenUserId: string): Promise<{
        status: string;
        message: string;
        error?: any;
      }> {
        try {
          const user = await this.userRepository.findOne({ where: { user_id } });
        if (!user) {
            throw new NotFoundException(`User with ID ${user_id} not found`);
        }
        if (user.user_id !== tokenUserId) {
            throw new UnauthorizedException('Access denied: Not your data.');
        }
        await this.userRepository.softDelete({ user_id });
        const updatedUser = await this.userRepository.findOne({
            where: { user_id },
            withDeleted: true
        });
        if (!updatedUser) throw new NotFoundException(`Updated user not found`);
        return {
            status: 'success',
            message: `User with ID ${user_id} soft deleted successfully`,
            error: null
        };
        } catch (error) {
          throw new InternalServerErrorException('Failed to soft delete user');
        }
    }

    async hardDeleteOne(user_id: string, tokenUserId: string): Promise<{
        status: string;
        message: string;
        error?: any;
      }> {
        try {
          const user = await this.userRepository.findOne({ where: { user_id } });
        if (!user) {
            throw new NotFoundException(`User with ID ${user_id} not found`);
        }
        if (user.user_id !== tokenUserId) {
            throw new UnauthorizedException('Access denied: Not your data.');
        }
        await this.userRepository.delete({ user_id });
        return {
            status: 'success',
            message: `User with ID ${user_id} permanently deleted`,
            error: null
        };
        } catch (error) {
          throw new InternalServerErrorException('Failed to delete user');
        }
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
