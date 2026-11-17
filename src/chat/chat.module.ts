import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from 'src/auth/auth.module';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatAccessService } from './chat-access.service';
import { ChatMembersService } from './chat-members.service';
import { ChatMessagesService } from './chat-messages.service';
import { ChatRoomsService } from './chat-rooms.service';
import { ProjectMemberEntity } from './models/project-member.entity';
import { ChatMessageEntity } from './models/chat-message.entity';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([ProjectMemberEntity, ChatMessageEntity]),
  ],
  controllers: [ChatController],
  providers: [
    ChatAccessService,
    ChatMembersService,
    ChatMessagesService,
    ChatRoomsService,
    ChatGateway,
  ],
})
export class ChatModule {}
