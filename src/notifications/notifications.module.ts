import { Module, forwardRef } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { TaskModule } from '../task/task.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsEntity } from './models/notifications.entity';
import { UserAwardEntity } from './models/user-award.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    AuthModule,
    forwardRef(() => TaskModule),
    TypeOrmModule.forFeature([NotificationsEntity, UserAwardEntity]),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
