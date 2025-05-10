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
}
