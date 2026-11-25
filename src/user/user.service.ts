import { isEmailLike, normalizeEmail } from './identifier';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { UserEntity } from './models/user.entity';
import { Repository } from 'typeorm';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bcrypt = require('bcrypt');
import { toTokenUser } from 'src/auth/token-user';
import { CreateUserDto } from './dto/create-user-dto';
import { UpdateUserDto } from './dto/update-user-dto';
import { AuthService, TokenPair } from 'src/auth/auth.service';
import { UserCleanupResponse } from './models/userCleanupResponse';
import { User } from './models/user.interface';
import { newId } from 'src/common/ids';
import { identifierKey } from 'src/auth/rate-limit/identifier-key';
import { LoginAttemptsService } from 'src/auth/rate-limit/login-attempts.service';

/** BUG-07: one message for a duplicate email or username. */
export const SIGNUP_TAKEN_MESSAGE = 'That email or username is already taken.';
export const SIGNUP_FAILED_MESSAGE = 'Failed to create account.';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly authService: AuthService,
    private readonly loginAttempts: LoginAttemptsService,
  ) {}

  /**
   * BUG-07: a duplicate email or username is a 409 with one message (it does
   * not say which one exists); any other failure is a 500 without database
   * text. Logs carry no email, username or Postgres detail.
   */
  async createUser(userDto: CreateUserDto): Promise<{
    status: 'success';
    message: string;
    data: UserCleanupResponse;
  }> {
    try {
      // Ensure password is a primitive string
      const password = String(userDto.password);

      // Hash the password
      const passwordHash = await this.authService
        .hashPassword(password)
        .toPromise();
      if (!passwordHash) {
        throw new Error('Failed to hash password');
      }

      const user_id = newId('user');

      // Create a new user instance with explicit typing
      const newUser = this.userRepository.create({
        fullname: String(userDto.fullname),
        username: String(userDto.username),
        email: normalizeEmail(String(userDto.email)),
        password: String(passwordHash), // Ensure it's a primitive string
        tier: 'free',
        role: 'standard',
        user_id,
        status: 'active',
      });

      // Save the new user with the hashed password
      const savedUser = await this.userRepository.save(newUser);

      // Remove password and the internal identityChangedAt (save() returns
      // columns with a database default) from the returned object.
      const {
        password: _,
        identityChangedAt: __,
        ...userWithoutPassword
      } = savedUser;

      return {
        status: 'success',
        message: 'User created successfully',
        data: userWithoutPassword,
      };
    } catch (error: unknown) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === '23505') {
        // Postgres unique violation. Its detail holds the email: never log it.
        this.logger.warn('signup duplicate');
        throw new ConflictException(SIGNUP_TAKEN_MESSAGE);
      }
      this.logger.error(
        'signup failed',
        typeof code === 'string' ? code : 'no code',
      );
      throw new InternalServerErrorException(SIGNUP_FAILED_MESSAGE);
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

  async softDeleteOne(
    user_id: string,
    tokenUserId: string,
  ): Promise<{
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
        withDeleted: true,
      });
      if (!updatedUser) throw new NotFoundException(`Updated user not found`);
      return {
        status: 'success',
        message: `User with ID ${user_id} soft deleted successfully`,
        error: null,
      };
    } catch {
      throw new InternalServerErrorException('Failed to soft delete user');
    }
  }

  async hardDeleteOne(
    user_id: string,
    tokenUserId: string,
  ): Promise<{
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
        error: null,
      };
    } catch {
      throw new InternalServerErrorException('Failed to delete user');
    }
  }

  async updateOne(
    user_id: string,
    updateUserDto: UpdateUserDto,
  ): Promise<UserCleanupResponse> {
    // identityChangedAt is select: false, so ask for it here.
    const user = await this.userRepository
      .createQueryBuilder('u')
      .addSelect('u.identityChangedAt')
      .where('u.user_id = :user_id', { user_id })
      .getOne();
    if (!user) {
      throw new NotFoundException(`User with ID ${user_id} not found`);
    }

    // Only allowlisted, defined fields reach the database.
    const changes: Partial<UserEntity> = {};
    if (updateUserDto.fullname !== undefined)
      changes.fullname = updateUserDto.fullname;
    if (updateUserDto.username !== undefined)
      changes.username = updateUserDto.username;
    if (updateUserDto.enableNotifications !== undefined)
      changes.enableNotifications = updateUserDto.enableNotifications;
    if (updateUserDto.theme !== undefined) changes.theme = updateUserDto.theme;
    if (updateUserDto.soundFx !== undefined)
      changes.soundFx = updateUserDto.soundFx;
    if (updateUserDto.pomodoroStyle !== undefined)
      changes.pomodoroStyle = updateUserDto.pomodoroStyle;

    const nameChanged =
      changes.fullname !== undefined && changes.fullname !== user.fullname;
    const usernameChanged =
      changes.username !== undefined && changes.username !== user.username;
    const passwordChanged = updateUserDto.password !== undefined;

    // The rule reads identityChangedAt, never updatedAt: a preference save
    // (theme, soundFx, pomodoroStyle) must not lock the name (FEAT-10a).
    const identityChanged = nameChanged || usernameChanged || passwordChanged;
    if (identityChanged) {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const last = user.identityChangedAt;
      if (last && last > sixMonthsAgo) {
        throw new BadRequestException(
          `You can only update name, username, or password once every 6 months. Last update: ${last.toISOString()}`,
        );
      }
    }
    if (passwordChanged) {
      changes.password = await bcrypt.hash(updateUserDto.password, 12);
    }

    if (Object.keys(changes).length > 0) {
      try {
        // The database clock, like updatedAt, the column default and the
        // migration backfill.
        await this.userRepository.update(
          { user_id },
          identityChanged
            ? { ...changes, identityChangedAt: () => 'now()' }
            : changes,
        );
      } catch (error: any) {
        if (error?.code === '23505') {
          throw new ConflictException('Username already exists.');
        }
        throw error;
      }
    }

    const updatedUser = await this.userRepository.findOne({
      where: { user_id },
    });
    if (!updatedUser) throw new NotFoundException(`Updated user not found`);

    const { password, ...sanitizedUser } = updatedUser;
    return sanitizedUser;
  }

  private toUser(userEntity: UserEntity): User {
    return toTokenUser(userEntity);
  }

  /**
   * BUG-08: an unknown email or username is the same 401 as a wrong password,
   * so the answer never says whether an account exists.
   */
  async validateUser(emailOrUsername: string, password: string): Promise<User> {
    // Get user with password for validation
    let user: User | UserEntity;
    try {
      user = await this.findByEmailOrUsername(emailOrUsername, true);
    } catch (e) {
      if (e instanceof NotFoundException) {
        throw new UnauthorizedException('Invalid credentials');
      }
      throw e;
    }

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await this.authService
      .comparePasswords(password, user.password)
      .toPromise();

    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Return sanitized user without password
    return this.toUser(user);
  }

  async findByEmailOrUsername(
    emailOrUsername: string,
    includePassword = false,
  ): Promise<User | UserEntity> {
    const isEmail = isEmailLike(emailOrUsername);

    if (isEmail) {
      // BUG-01: case-insensitive and trimmed, one query.
      const user = await this.userRepository
        .createQueryBuilder('u')
        .where('lower(u.email) = :email', {
          email: normalizeEmail(emailOrUsername),
        })
        .getOne();
      if (!user) {
        throw new NotFoundException(
          `User with email ${emailOrUsername} not found`,
        );
      }
      return includePassword ? user : this.toUser(user);
    } else {
      const user = await this.userRepository.findOne({
        where: { username: emailOrUsername },
      });
      if (!user) {
        throw new NotFoundException(
          `User with username ${emailOrUsername} not found`,
        );
      }
      return includePassword ? user : this.toUser(user);
    }
  }

  async loginEmail(credentials: {
    email: string;
    password: string;
    rememberMe?: boolean;
    ipAddress?: string | null;
  }): Promise<{
    status: string;
    message: string;
    data?: TokenPair;
    error?: any;
  }> {
    const { email, password } = credentials;

    if (!email || !password) {
      throw new Error('Email and password are required.');
    }

    return this.login(email, password, identifierKey({ email }), credentials);
  }

  async loginUsername(credentials: {
    username: string;
    password: string;
    rememberMe?: boolean;
    ipAddress?: string | null;
  }): Promise<{
    status: string;
    message: string;
    data?: TokenPair;
    error?: any;
  }> {
    const { username, password } = credentials;

    if (!username || !password) {
      throw new Error('Username and password are required.');
    }

    return this.login(
      username,
      password,
      identifierKey({ username }),
      credentials,
    );
  }

  /**
   * BUG-08: the lock is checked before the lookup and the password check, so
   * a locked account gets 429 even with the right password. The attempt is
   * counted as a failure up front (synchronously, before any await), so
   * parallel guesses cannot all pass the check before one is recorded; a
   * success clears the count, a wrong password or unknown account keeps it.
   * key is null only for an identifier the DTO would already reject.
   */
  private async login(
    identifier: string,
    password: string,
    key: string | null,
    opts: { ipAddress?: string | null; rememberMe?: boolean },
  ) {
    if (key) {
      this.loginAttempts.assertNotLocked(key);
      this.loginAttempts.recordFailure(key);
    }
    let validatedUser: User;
    try {
      validatedUser = await this.validateUser(identifier, password);
    } catch {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (key) this.loginAttempts.clear(key);
    try {
      return await this.issueSession(
        validatedUser,
        opts.ipAddress,
        opts.rememberMe,
      );
    } catch {
      throw new UnauthorizedException('Invalid credentials');
    }
  }

  /** Login: new token family, lifetimes reported from the signed tokens. */
  private async issueSession(
    user: User,
    ip: string | null | undefined,
    rememberMe?: boolean,
  ) {
    const access = this.authService.generateAccessToken(user);
    const refresh = await this.authService.generateRefreshToken(user, {
      ip,
      rememberMe: rememberMe === true,
    });
    return {
      status: 'success',
      message: 'Login successful',
      data: this.authService.buildPair(access, refresh),
      error: null,
    };
  }
}
