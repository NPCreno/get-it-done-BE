import { User } from "src/user/models/user.interface";

export interface TokenPayload {
    user: User;
    sub: string;
    type: 'access' | 'refresh';
    jti?: string;
    family?: string;
}