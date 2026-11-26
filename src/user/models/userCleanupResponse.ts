export interface UserCleanupResponse {
  user_id: string;
  fullname: string;
  username: string;
  email: string;
  tier: string;
  theme?: string | null;
  pomodoroStyle?: string | null;
  appTheme?: string | null;
  role: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}
