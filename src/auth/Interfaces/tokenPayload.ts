export interface TokenPayload {
    sub: string;
    type: 'access' | 'refresh';
    jti?: string;
    family?: string;
}