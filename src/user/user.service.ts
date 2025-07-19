import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { UserEntity } from './models/user.entity';
import { Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user-dto';
import { UpdateUserDto } from './dto/update-user-dto';
import { AuthService } from 'src/auth/auth.service';
import { UserCleanupResponse } from './models/userCleanupResponse';
import { User } from './models/user.interface';

@Injectable()
export class UserService {
    constructor (
        @InjectRepository(UserEntity) private readonly userRepository: Repository<UserEntity>,
        private readonly authService: AuthService,
    ){}
    
    private generateUserId(): string {
      const randomNumber = Math.floor(Math.random() * 1_000_000_000); // 0 to 999,999,999
      return 'user-' + randomNumber.toString().padStart(9, '0');
    }

    async createUser(userDto: CreateUserDto): Promise<{
      status: string;
      message: string;
      data?: UserCleanupResponse | null;
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
      } catch (error: any) {
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

    async findOne(user_id: string): Promise<UserCleanupResponse | null> {
      const user = await this.userRepository.findOne({ where: { user_id } });
      if (!user) return null;
      const { password, ...result } = user;
      return result;
    }

    async findAll(): Promise<UserCleanupResponse[]> {
      const users = await this.userRepository.find();
      return users.map(({ password, ...user }) => user);
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


  async updateOne(user_id: string, updateUserDto: UpdateUserDto): Promise<UserCleanupResponse> {
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

    private toUser(userEntity: UserEntity): User {
    const [firstname, ...lastnameParts] = userEntity.fullname?.split(' ') || [];
    const lastname = lastnameParts.join(' ');
    
    return {
      ...userEntity,
      id: userEntity.id,
      user_id: userEntity.user_id,
      firstname: firstname || '',
      lastname: lastname || '',
      username: userEntity.username,
      email: userEntity.email,
      password: userEntity.password,
      tier: userEntity.tier,
      role: userEntity.role,
      status: userEntity.status,
      enableNotifications: userEntity.enableNotifications,
      theme: userEntity.theme,
      soundFx: userEntity.soundFx,
      emailToLowerCase: function() {
        this.email = this.email.toLowerCase();
      }
    } as User;
  }

  private sanitizeUser(user: UserEntity): UserCleanupResponse {
    const [firstname, ...lastnameParts] = user.fullname?.split(' ') || [];
    const lastname = lastnameParts.join(' ');
    
    return {
      user_id: user.user_id,
      fullname: user.fullname,
      username: user.username,
      email: user.email,
      tier: user.tier,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  }

    async validateUser(emailOrUsername: string, password: string): Promise<User> {
      const user = await this.findByEmailOrUsername(emailOrUsername);
      
      if (!user) {
        throw new UnauthorizedException('Invalid credentials');
      }
      
      const isMatch = await this.authService.comparePasswords(password, user.password).toPromise();
      
      if (!isMatch) {
        throw new UnauthorizedException('Invalid credentials');
      }
      
      return this.toUser(user);
    }

    async findByEmailOrUsername(emailOrUsername: string): Promise<User> {
      const isEmail = /\S+@\S+\.\S+/.test(emailOrUsername);
      
      if (isEmail) {
        const user = await this.userRepository.findOne({ where: { email: emailOrUsername } });
        if (!user) {
            throw new NotFoundException(`User with email ${emailOrUsername} not found`);
        }
        return this.toUser(user);
      } else {
        const user = await this.userRepository.findOne({ where: { username: emailOrUsername } });
        if (!user) {
            throw new NotFoundException(`User with username ${emailOrUsername} not found`);
        }
        return this.toUser(user);
      }
    }

    async loginEmail(credentials: { email: string; password: string }): Promise<
    {
      status: string;
      message: string;
      data?: {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };
      error?: any;
    }
    > {
      const { email, password } = credentials;

      if (!email || !password) {
        throw new Error('Email and password are required.');
      }
      
      try {
        const validatedUser = await this.validateUser(email, password);
        const jwt = await this.authService.generateJWT(validatedUser).toPromise();
        if (!jwt) {
          throw new Error('Failed to generate JWT token');
        }
        return {
          status: 'success',
          message: 'Login successful',
          data: {
            access_token: jwt.toString(),
            refresh_token: jwt.toString(),
            expires_in: 3600
          },
          error: null
        };
      } catch (error) {
        throw new UnauthorizedException('Invalid credentials');
      }
    }

    async loginUsername(credentials: { username: string; password: string }): Promise<{
      status: string;
      message: string;
      data?: {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };
      error?: any;
    }> {
      const { username, password } = credentials;

      if (!username || !password) {
        throw new Error('Username and password are required.');
      }
      
      try {
        const validatedUser = await this.validateUser(username, password);
        const jwt = await this.authService.generateJWT(validatedUser).toPromise();
        if (!jwt) {
          throw new Error('Failed to generate JWT token');
        }
        return {
          status: 'success',
          message: 'Login successful',
          data: {
            access_token: jwt.toString(),
            refresh_token: jwt.toString(),
            expires_in: 3600
          },
          error: null
        };
      } catch (error) {
        throw new UnauthorizedException('Invalid credentials');
      }
    }
}
