import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthTokenEntity } from './models/auth.entity';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
    imports: [
        JwtModule.registerAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: async (configService: ConfigService) => ({
                secret: configService.get('JWT_SECRET'),
                signOptions: {expiresIn: '1d'} //Token expires in 1d
            })
        }),
        TypeOrmModule.forFeature([AuthTokenEntity]),
    ],
    providers: [AuthService],
    exports: [AuthService, JwtModule],
    controllers: [AuthController],

})
export class AuthModule {}
