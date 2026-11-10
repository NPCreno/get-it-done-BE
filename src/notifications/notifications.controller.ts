import { Controller, Delete, MessageEvent, Param, Sse, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Observable } from 'rxjs';
import { NotificationsService } from './notifications.service';
import { AuthorizeGuard } from 'src/auth/guards/authorize.guard';
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

  @UseGuards(AuthorizeGuard)
  @Delete('clear/:user_id')
  async clearNotifications(@Param('user_id') user_id: string, @AuthUserId() userId: string) {
    if (user_id !== userId) {
      throw new UnauthorizedException('Access denied: Not your data.');
    }
    await this.notificationsService.clearNotifications(user_id);
    return { message: 'Notifications cleared successfully' };
  }
}
