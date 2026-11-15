import {
  Controller,
  Delete,
  MessageEvent,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { NotificationsService } from './notifications.service';
import { AuthorizeGuard } from 'src/auth/guards/authorize.guard';
import { SelfParam } from 'src/auth/guards/self-param.guard';
import { AuthUserId } from 'src/auth/decorators/auth-user-id.decorator';

@Controller('api/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Streams only the caller's events. Browser EventSource cannot send an
   * Authorization header, so a consumer must use fetch-based streaming.
   */
  @UseGuards(AuthorizeGuard)
  @Sse('sse')
  sse(@AuthUserId() userId: string): Observable<MessageEvent> {
    return this.notificationsService.getNotificationStream(userId);
  }

  @UseGuards(AuthorizeGuard, SelfParam('user_id'))
  @Delete('clear/:user_id')
  async clearNotifications(@AuthUserId() userId: string) {
    await this.notificationsService.clearNotifications(userId);
    return { message: 'Notifications cleared successfully' };
  }
}
