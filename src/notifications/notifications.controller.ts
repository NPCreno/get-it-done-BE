import { Controller, Delete, MessageEvent, Param, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { NotificationsService } from './notifications.service';

@Controller('api/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Sse('sse')
  sse(): Observable<MessageEvent> {
    return this.notificationsService.getNotificationStream();
  }

  @Delete('clear/:user_id')
  clearNotifications(@Param('user_id') user_id: string) {
    this.notificationsService.clearNotifications(user_id);
    return { message: 'Notifications cleared successfully' };
  }
}
