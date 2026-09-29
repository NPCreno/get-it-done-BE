import { Module, forwardRef } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { TaskModule } from '../task/task.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsEntity } from './models/notifications.entity';

@Module({
  imports: [
    forwardRef(() => TaskModule),
    TypeOrmModule.forFeature([NotificationsEntity])
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService]
})
export class NotificationsModule {}