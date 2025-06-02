import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { TaskService } from './task.service';

@Controller('api/projects')
export class TaskController {
    constructor(private taskService: TaskService){}
    
}