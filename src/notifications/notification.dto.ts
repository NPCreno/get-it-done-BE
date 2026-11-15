import { NotificationsEntity } from './models/notifications.entity';

/** Public shape. Never spread the entity: metadata, actionTarget and user stay private. */
export interface NotificationDto {
  notif_id: string;
  type: NotificationsEntity['type'];
  title: string;
  message: string;
  read: boolean;
  actionType: NotificationsEntity['actionType'] | null;
  createdAt: string;
}

export function toNotificationDto(n: NotificationsEntity): NotificationDto {
  return {
    notif_id: n.notif_id,
    type: n.type,
    title: n.title,
    message: n.message,
    read: n.read,
    actionType: n.actionType ?? null,
    createdAt: new Date(n.createdAt).toISOString(),
  };
}
