import {
  Controller,
  Delete,
  Get,
  MessageEvent,
  Param,
  Patch,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { NotificationsService } from './notifications.service';
import { AuthorizeGuard } from 'src/auth/guards/authorize.guard';
import { SelfParam } from 'src/auth/guards/self-param.guard';
import { AuthUserId } from 'src/auth/decorators/auth-user-id.decorator';
import { TokenExp } from 'src/auth/decorators/token-exp.decorator';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';

@Controller('api/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Streams only the caller's events and ends at the token's expiry (the
   * client reconnects with a fresh token). Browser EventSource cannot send an
   * Authorization header, so a consumer must use fetch-based streaming.
   */
  @UseGuards(AuthorizeGuard)
  @Sse('sse')
  sse(
    @AuthUserId() userId: string,
    @TokenExp() expiresAtMs?: number,
  ): Observable<MessageEvent> {
    return this.notificationsService.getNotificationStream(userId, expiresAtMs);
  }

  @UseGuards(AuthorizeGuard)
  @Get()
  async list(
    @AuthUserId() userId: string,
    @Query() query: ListNotificationsQueryDto,
  ) {
    const data = await this.notificationsService.list(
      userId,
      query.limit,
      query.cursor,
    );
    return { status: 'success', data };
  }

  @UseGuards(AuthorizeGuard)
  @Patch('read-all')
  async readAll(@AuthUserId() userId: string) {
    const updated = await this.notificationsService.markAllRead(userId);
    return { status: 'success', data: { updated } };
  }

  @UseGuards(AuthorizeGuard)
  @Patch(':notif_id/read')
  async read(@AuthUserId() userId: string, @Param('notif_id') notifId: string) {
    await this.notificationsService.markRead(userId, notifId);
    return { status: 'success', data: { notif_id: notifId, read: true } };
  }

  @UseGuards(AuthorizeGuard, SelfParam('user_id'))
  @Delete('clear/:user_id')
  async clearNotifications(@AuthUserId() userId: string) {
    await this.notificationsService.clearNotifications(userId);
    return { message: 'Notifications cleared successfully' };
  }
}
