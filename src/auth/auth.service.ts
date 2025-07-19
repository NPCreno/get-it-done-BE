import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { from, Observable, of } from 'rxjs';
import { User } from 'src/user/models/user.interface';
import { TokenPayload } from './Interfaces/tokenPayload';
import { AuthTokenEntity } from './models/auth.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
const bcrypt = require('bcrypt');
@Injectable()
export class AuthService {
    constructor(
        private readonly jwtService: JwtService,
        @InjectRepository(AuthTokenEntity)
        private readonly authTokenRepository: Repository<AuthTokenEntity>
    ){}

      // Generate Access Token (short-lived)
    generateAccessToken(user: User): string {
        const payload: TokenPayload = {
        sub: user.user_id.toString(),
        type: 'access',
        jti: crypto.randomUUID(),
        };
        return this.jwtService.sign(payload, {
        expiresIn: '15m',
        secret: process.env.JWT_SECRET
        });
    }

    generateJWT(user: User): Observable <String>{
        const payload = { user }; // You can include more data in the payload if needed.
        return of(this.jwtService.sign(payload)); 
    }

    hashPassword(password: string): Observable <String>{
        return from<String>(bcrypt.hash(password, 12)); 
    }

    comparePasswords(newPassword: string, passwordHash: string): Observable <any | boolean>{
        return from<any | boolean>(bcrypt.compare(newPassword, passwordHash)); 
    }

    generateRefreshToken(refreshToken: string, ipAddress: string, user: User): string {
        const payload: TokenPayload = {
        sub: user.user_id.toString(),
        type: 'refresh',
        jti: crypto.randomUUID(),
        };
        return this.jwtService.sign(payload, {
        expiresIn: '7d',
        secret: process.env.JWT_SECRET
        });
    }
}
