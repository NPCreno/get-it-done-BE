import { UserEntity } from "src/user/models/user.entity";
import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
    user: UserEntity; 
}