import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { from, Observable, of } from 'rxjs';
import { User } from 'src/user/models/user.interface';
import { TokenPayload } from './Interfaces/tokenPayload';
import { AuthTokenEntity } from './models/auth.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { UserService } from 'src/user/user.service';
import { UserEntity } from 'src/user/models/user.entity';
const bcrypt = require('bcrypt');
@Injectable()
export class AuthService {

    constructor(
        private readonly jwtService: JwtService,
        @InjectRepository(AuthTokenEntity)
        private readonly authTokenRepository: Repository<AuthTokenEntity>,
        @InjectRepository(UserEntity)
        private readonly usersRepository: Repository<UserEntity>,
    ){}

    generateAccessToken(user: User): string {
        const payload: TokenPayload = {
        user,
        sub: user.user_id.toString(),
        type: 'access',
        jti: crypto.randomUUID(),
        };
        return this.jwtService.sign(payload, {
        expiresIn: '15m',
        secret: process.env.JWT_SECRET
        });
    }

    generateJWT(user: User): string{
        const payload = { user }; 
        return this.jwtService.sign(payload); 
    }

    hashPassword(password: string): Observable <String>{
        return from<String>(bcrypt.hash(password, 12)); 
    }

    comparePasswords(newPassword: string, passwordHash: string): Observable <any | boolean>{
        return from<any | boolean>(bcrypt.compare(newPassword, passwordHash)); 
    }


    async generateRefreshToken(user: User, ipAddress: string, rememberMe: boolean): Promise<string> {
        const tokenId = crypto.randomUUID();
        const refreshToken = this.jwtService.sign(
            {
                sub: user.user_id.toString(),
                jti: tokenId,
                type: 'refresh',
            },
            {
                expiresIn: rememberMe ? '7d' : '1d',
                secret: process.env.JWT_REFRESH_SECRET || 'refreshSecretKey',
            }
        );

        // Save refresh token to database
        const authToken = new AuthTokenEntity();
        authToken.token_id = tokenId;
        authToken.user_id = user.user_id.toString();
        authToken.token = await bcrypt.hash(refreshToken, 10); // Store hashed token
        authToken.expires_at = rememberMe ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : new Date(Date.now() + 1 * 24 * 60 * 60 * 1000);
        authToken.is_revoked = false;
        authToken.ip_address = ipAddress;
        authToken.family_id = crypto.randomUUID(); // For token rotation

        await this.authTokenRepository.save(authToken);

        return refreshToken;
    }

    async validateRefreshToken(token: string, ipAddress: string): Promise<{ userId: string; tokenId: string }> {
        try {
            const payload = this.jwtService.verify(token, {
                secret: process.env.JWT_REFRESH_SECRET || 'refreshSecretKey',
            });

            if (payload.type !== 'refresh') {
                throw new Error('Invalid token type');
            }

            const tokenRecord = await this.authTokenRepository.findOne({
                where: { token_id: payload.jti, is_revoked: false },
            });

            if (!tokenRecord) {
                throw new Error('Token not found or revoked');
            }

            // Verify the token matches the stored hash
            const isValid = await bcrypt.compare(token, tokenRecord.token);
            if (!isValid) {
                throw new Error('Invalid token');
            }

            // Update IP address if it's different
            if (tokenRecord.ip_address !== ipAddress) {
                tokenRecord.ip_address = ipAddress;
                await this.authTokenRepository.save(tokenRecord);
            }

            return { userId: tokenRecord.user_id, tokenId: tokenRecord.token_id };
        } catch (error) {
            console.error("Error validating refresh token: ", error);
            throw new Error('Invalid refresh token');
        }
    }

    async revokeRefreshToken(tokenId: string): Promise<void> {
        await this.authTokenRepository.update(
            { token_id: tokenId },
            { is_revoked: true }
        );
    }

    async revokeUserRefreshTokens(userId: string): Promise<void> {
        await this.authTokenRepository.update(
            { user_id: userId },
            { is_revoked: true }
        );
    }

    async refreshAccessToken(refreshToken: string, ipAddress: string): Promise<{
        status: string,
        message: string;
        data?: {
            access_token: string;
            refresh_token: string;
        };
        error?: any;
    }> {
        try {
        // Validate the refresh token
        const { userId, tokenId } = await this.validateRefreshToken(refreshToken, ipAddress);
        
        // Get user from database (you'll need to inject the user service)
        const user = await this.usersRepository.findOne({ where: { user_id: userId } });
        if (!user) {
            throw new Error('User not found');
        }

        // For now, we'll just return a new access token
        // In a real implementation, you would get the user object from the database
        // Revoke the used refresh token (optional: implement refresh token rotation)
        await this.revokeRefreshToken(tokenId);
        
        // Convert UserEntity to User type
        const [firstname, ...lastnameParts] = user.fullname?.split(' ') || [];
        const lastname = lastnameParts.join(' ');
        const userForToken = {
          ...user,
          firstname: firstname || '',
          lastname: lastname || ''
        };
        
        // Generate new tokens
        const accessToken = this.generateAccessToken(userForToken as User);
        // If using refresh token rotation, generate a new refresh token here
        const newRefreshToken = await this.generateRefreshToken(userForToken as User, ipAddress, true);
        
        console.log("newRefreshToken: ", newRefreshToken);
        return {
            status: 'success',
            message: 'Access token generated successfully',
            data: {
                access_token: accessToken,
                refresh_token: newRefreshToken
            }
        };
    } catch (error: any) {
        console.error("Error refreshing access token: ", error);
        return {
            status: 'error',
            message: 'Failed to generate access token',
            error: error
        };
    }
}
}
