import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthorizeGuard } from 'src/auth/guards/authorize.guard';
import { AuthUserId } from 'src/auth/decorators/auth-user-id.decorator';
import { RateLimit } from 'src/auth/rate-limit/rate-limit.decorator';
import { ChatMembersService } from './chat-members.service';
import { ChatMessagesService } from './chat-messages.service';
import { AddMemberDto } from './dto/add-member.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';

/**
 * Project sharing and chat (FEAT-05). Its own prefix, so nothing collides with
 * /api/projects/:project_id. Every route needs a token; who may do what is
 * decided in the services (ChatAccessService.assertCanChat). AuthorizeGuard is
 * on the class so it runs before a route's @RateLimit guard, which keys on the
 * token user.
 */
@UseGuards(AuthorizeGuard)
@Controller('api/chat')
export class ChatController {
  constructor(
    private readonly members: ChatMembersService,
    private readonly messages: ChatMessagesService,
  ) {}

  @Get('shared-projects')
  async sharedProjects(@AuthUserId() userId: string) {
    return { status: 'success', data: await this.members.sharedWith(userId) };
  }

  @Get('projects/:project_id/members')
  async listMembers(
    @AuthUserId() userId: string,
    @Param('project_id') projectId: string,
  ) {
    return {
      status: 'success',
      data: await this.members.list(projectId, userId),
    };
  }

  @RateLimit('chatMember')
  @Post('projects/:project_id/members')
  async addMember(
    @AuthUserId() userId: string,
    @Param('project_id') projectId: string,
    @Body() dto: AddMemberDto,
  ) {
    return {
      status: 'success',
      data: await this.members.add(projectId, userId, dto.username),
    };
  }

  @Delete('projects/:project_id/members/:user_id')
  @HttpCode(200)
  async removeMember(
    @AuthUserId() userId: string,
    @Param('project_id') projectId: string,
    @Param('user_id') targetUserId: string,
  ) {
    return {
      status: 'success',
      data: await this.members.remove(projectId, userId, targetUserId),
    };
  }

  @Get('projects/:project_id/messages')
  async listMessages(
    @AuthUserId() userId: string,
    @Param('project_id') projectId: string,
    @Query() query: ListMessagesQueryDto,
  ) {
    return {
      status: 'success',
      data: await this.messages.list(
        projectId,
        userId,
        query.limit,
        query.cursor,
      ),
    };
  }

  @RateLimit('chatMessage')
  @Post('projects/:project_id/messages')
  async sendMessage(
    @AuthUserId() userId: string,
    @Param('project_id') projectId: string,
    @Body() dto: SendMessageDto,
  ) {
    return {
      status: 'success',
      data: await this.messages.send(projectId, userId, dto.body),
    };
  }

  @Delete('projects/:project_id/messages/:id')
  @HttpCode(200)
  async deleteMessage(
    @AuthUserId() userId: string,
    @Param('project_id') projectId: string,
    @Param('id', new ParseUUIDPipe()) messageId: string,
  ) {
    return {
      status: 'success',
      data: await this.messages.remove(projectId, userId, messageId),
    };
  }
}
