import { Body, Module, Param, Post } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Projects } from './models/projects.entity';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Projects]),
    AuthModule,
  ],
  providers: [ProjectsService],
  controllers: [ProjectsController]
})

export class ProjectsModule {}


