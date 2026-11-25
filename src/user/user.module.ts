import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './models/user.entity';
import { AuthModule } from 'src/auth/auth.module';
import { LoginAttemptsService } from 'src/auth/rate-limit/login-attempts.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity]), AuthModule],
  providers: [UserService, LoginAttemptsService],
  controllers: [UserController],
  exports: [UserService],
})
export class UserModule {}
