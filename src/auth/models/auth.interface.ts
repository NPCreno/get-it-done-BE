import { AuthTokenEntity } from "./auth.entity";
export interface AuthToken extends AuthTokenEntity{
    id: number;
    token_id: string;
    user_id: string;
    token: string;
    createdAt: Date;
    expires_at: Date;
    is_revoked: boolean;
    ip_address: string;
}