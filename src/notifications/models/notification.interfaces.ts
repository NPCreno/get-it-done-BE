export interface NotificationRule {
  condition: { every?: number; equals?: number };
  type:
    | 'achievement'
    | 'milestone'
    | 'streak'
    | 'levelUp'
    | 'reward'
    | 'taskDue';
  title: string;
  message: string;
  actionType?: 'acknowledge' | 'complete' | 'claim';
  actionTarget?: string;
  metadata?: Record<string, any>;
}
