export interface UserCleanupResponse {
    user_id: string;
    fullname: string;
    username: string;
    email: string;
    tier: string;
    role: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
}