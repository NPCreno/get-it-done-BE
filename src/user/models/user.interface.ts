import { UserEntity } from "./user.entity";

export interface User extends UserEntity{
    id: number;
    user_id: string;
    firstname: string;
    lastname: string;
    username: string;
    email: string;
    password: string;
    tier: string;
}