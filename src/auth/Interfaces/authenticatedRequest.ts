import { Request } from 'express';
import { TokenPayload } from './tokenPayload';

export interface AuthenticatedRequest extends Request {
    user: TokenPayload;
}
