import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { from, Observable, of } from 'rxjs';
import { User } from 'src/user/models/user.interface';
const bcrypt = require('bcrypt');
@Injectable()
export class AuthService {
    constructor(
        private readonly jwtService: JwtService
    ){}

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

      // Generate Refresh Token
    generateRefreshToken(user: User): string {
        const payload = { user }; // Same payload or different one based on your needs
        return this.jwtService.sign(payload, { expiresIn: '1d' }); // 1 day for refresh token
    }

    // Validate the Refresh Token and issue new Access Token
    async refreshAccessToken(refreshToken: string): Promise<any | string> { 
        const decoded = this.jwtService.verify(refreshToken); // Verify refresh token
        const user = decoded.user; // Get user info from payload (or look it up in DB)
        return this.generateJWT(user); // Generate a new access token
    }
}
